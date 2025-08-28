/** @typedef {'head' | 'body'} PayloadType */
/** @typedef {{ [key in PayloadType]: string }} AccumulatedContent */
/** @typedef {{ start: number, end: number, fn: (content: AccumulatedContent) => AccumulatedContent | Promise<AccumulatedContent> }} Compaction */
/**
 * @template T
 * @typedef {T | Promise<T>} MaybePromise<T>
 */

/**
 * Payloads are basically a tree of `string | Payload`s, where each `Payload` in the tree represents
 * work that may or may not have completed. A payload can be {@link collect}ed to aggregate the
 * content from itself and all of its children, but this will throw if any of the children are
 * performing asynchronous work. To asynchronously collect a payload, just `await` it.
 *
 * The `string` values within a payload are always associated with the {@link type} of that payload. To switch types,
 * call {@link child} with a different `type` argument.
 */
export class Payload {
	/**
	 * The contents of the payload.
	 * @type {(string | Payload)[]}
	 */
	#out = [];

	/**
	 * The type of string content that this payload is accumulating.
	 * @type {PayloadType}
	 */
	type;

	/** @type {Payload | undefined} */
	parent;

	/**
	 * Asynchronous work associated with this payload. `initial` is the promise from the function
	 * this payload was passed to (if that function was async), and `followup` is any any additional
	 * work from `compact` calls that needs to complete prior to collecting this payload's content.
	 * @type {{ initial: Promise<void> | undefined, followup: Promise<void>[] | undefined }}
	 */
	promises = { initial: undefined, followup: undefined };

	/**
	 * State which is associated with the content tree as a whole.
	 * It will be re-exposed, uncopied, on all children.
	 * @type {TreeState}
	 * @readonly
	 */
	global;

	/**
	 * State that is local to the branch it is declared in.
	 * It will be shallow-copied to all children.
	 * @type {{ select_value: string | undefined }}
	 */
	local;

	/**
	 * @param {TreeState} [global]
	 * @param {{ select_value: string | undefined }} [local]
	 * @param {Payload | undefined} [parent]
	 * @param {PayloadType} [type]
	 */
	constructor(global = new TreeState(), local = { select_value: undefined }, parent, type) {
		this.global = global;
		this.local = { ...local };
		this.parent = parent;
		this.type = type ?? parent?.type ?? 'body';
	}

	/**
	 * Create a child payload. The child payload inherits the state from the parent,
	 * but has its own content.
	 * @param {(tree: Payload) => MaybePromise<void>} render
	 * @param {PayloadType} [type]
	 * @returns {void}
	 */
	child(render, type) {
		const child = new Payload(this.global, this.local, this, type);
		this.#out.push(child);
		const result = render(child);
		if (result instanceof Promise) {
			child.promises.initial = result;
		}
	}

	/**
	 * @param {(value: { head: string, body: string }) => void} onfulfilled
	 */
	async then(onfulfilled) {
		const content = await Payload.#collect_content([this], this.type);
		return onfulfilled(content);
	}

	/**
	 * @param {string} content
	 */
	push(content) {
		this.#out.push(content);
	}

	/**
	 * Compact everything between `start` and `end` into a single payload, then call `fn` with the result of that payload.
	 * The compacted payload will be sync if all of the children are sync and {@link fn} is sync, otherwise it will be async.
	 * @param {{ start: number, end?: number, fn: (content: AccumulatedContent) => AccumulatedContent }} args
	 */
	compact({ start, end = this.#out.length, fn }) {
		const child = new Payload(this.global, this.local, this);
		const to_compact = this.#out.splice(start, end - start, child);
		const content = Payload.#collect_content(to_compact, this.type);

		if (content instanceof Promise) {
			const followup = content
				.then((content) => fn(content))
				.then((transformed_content) =>
					Payload.#push_accumulated_content(child, transformed_content)
				);
			(this.promises.followup ??= []).push(followup);
		} else {
			Payload.#push_accumulated_content(child, fn(content));
		}
	}

	/**
	 * @returns {number[]}
	 */
	get_path() {
		return this.parent ? [...this.parent.get_path(), this.parent.#out.indexOf(this)] : [];
	}

	/**
	 * Collect all of the code from the `out` array and return it as a string. Throws if any of the children are
	 * performing asynchronous work.
	 * @returns {AccumulatedContent}
	 */
	collect() {
		const content = Payload.#collect_content(this.#out, this.type);
		if (content instanceof Promise) {
			// TODO is there a good way to report where this is? Probably by using some sort of loc or stack trace in `child` creation.
			throw new Error('Encountered an asynchronous component while rendering synchronously');
		}

		return content;
	}

	copy() {
		const copy = new Payload(this.global, this.local, this.parent, this.type);
		copy.#out = this.#out.map((item) => (typeof item === 'string' ? item : item.copy()));
		copy.promises = this.promises;
		return copy;
	}

	/**
	 * @param {Payload} other
	 */
	subsume(other) {
		this.global.subsume(other.global);
		this.local = other.local;
		this.#out = other.#out.map((item) => {
			if (typeof item !== 'string') {
				item.subsume(item);
			}
			return item;
		});
		this.promises = other.promises;
		this.type = other.type;
	}

	get length() {
		return this.#out.length;
	}

	/**
	 * Collect all of the code from the `out` array and return it as a string, or a promise resolving to a string.
	 * @param {(string | Payload)[]} items
	 * @param {PayloadType} current_type
	 * @param {AccumulatedContent} content
	 * @returns {MaybePromise<AccumulatedContent>}
	 */
	static #collect_content(items, current_type, content = { head: '', body: '' }) {
		/** @type {MaybePromise<AccumulatedContent>[]} */
		const segments = [];
		let has_async = false;

		const flush = () => {
			if (content.head || content.body) {
				segments.push(content);
				content = { head: '', body: '' };
			}
		};

		for (const item of items) {
			if (typeof item === 'string') {
				content[current_type] += item;
			} else {
				flush();

				if (item.promises.initial) {
					has_async = true;
					segments.push(
						Payload.#collect_content_async([item], current_type, { head: '', body: '' })
					);
				} else {
					const sub = Payload.#collect_content(item.#out, item.type, { head: '', body: '' });
					if (sub instanceof Promise) {
						has_async = true;
					}
					segments.push(sub);
				}
			}
		}

		flush();

		if (has_async) {
			return Promise.all(segments).then((content_array) =>
				Payload.#squash_accumulated_content(content_array)
			);
		}

		// No async segments — combine synchronously
		return Payload.#squash_accumulated_content(/** @type {AccumulatedContent[]} */ (segments));
	}

	/**
	 * Collect all of the code from the `out` array and return it as a string.
	 * @param {(string | Payload)[]} items
	 * @param {PayloadType} current_type
	 * @param {AccumulatedContent} content
	 * @returns {Promise<AccumulatedContent>}
	 */
	static async #collect_content_async(items, current_type, content = { head: '', body: '' }) {
		for (const item of items) {
			if (typeof item === 'string') {
				content[current_type] += item;
			} else {
				if (item.promises.initial) {
					// this represents the async function that's modifying this payload.
					// we can't do anything until it's done and we know our `out` array is complete.
					await item.promises.initial;
				}
				for (const followup of item.promises.followup ?? []) {
					// this is sequential because `compact` could synchronously queue up additional followup work
					await followup;
				}
				await Payload.#collect_content_async(item.#out, item.type, content);
			}
		}
		return content;
	}

	/**
	 * @param {Payload} tree
	 * @param {AccumulatedContent} accumulated_content
	 */
	static #push_accumulated_content(tree, accumulated_content) {
		for (const [type, content] of Object.entries(accumulated_content)) {
			if (!content) continue;
			const child = new Payload(tree.global, tree.local, tree, /** @type {PayloadType} */ (type));
			child.push(content);
			tree.#out.push(child);
		}
	}

	/**
	 * @param {AccumulatedContent[]} content_array
	 * @returns {AccumulatedContent}
	 */
	static #squash_accumulated_content(content_array) {
		return content_array.reduce(
			(acc, content) => {
				acc.head += content.head;
				acc.body += content.body;
				return acc;
			},
			{ head: '', body: '' }
		);
	}
}

export class TreeState {
	/** @type {() => string} */
	#uid;

	/** @type {Set<{ hash: string; code: string }>} */
	#css;

	/** @type {TreeHeadState} */
	#head;

	get css() {
		return this.#css;
	}

	get uid() {
		return this.#uid;
	}

	get head() {
		return this.#head;
	}

	/**
	 * @param {string} [id_prefix]
	 */
	constructor(id_prefix = '') {
		this.#uid = props_id_generator(id_prefix);
		this.#css = new Set();
		this.#head = new TreeHeadState(this.#uid);
	}

	copy() {
		const state = new TreeState();
		state.#css = new Set(this.#css);
		state.#head = this.#head.copy();
		state.#uid = this.#uid;
		return state;
	}

	/**
	 * @param {TreeState} other
	 */
	subsume(other) {
		this.#css = other.#css;
		this.#uid = other.#uid;
		this.#head.subsume(other.#head);
	}
}

export class TreeHeadState {
	/** @type {Set<{ hash: string; code: string }>} */
	#css = new Set();

	/** @type {() => string} */
	#uid = () => '';

	/**
	 * @type {{ path: number[], value: string }}
	 */
	#title = { path: [], value: '' };

	get css() {
		return this.#css;
	}

	get uid() {
		return this.#uid;
	}

	get title() {
		return this.#title;
	}
	set title(value) {
		// perform a depth-first (lexicographic) comparison using the path. Reject sets
		// from earlier than or equal to the current value.
		const contender_path = value.path;
		const current_path = this.#title.path;

		const max_len = Math.max(contender_path.length, current_path.length);
		for (let i = 0; i < max_len; i++) {
			const contender_segment = contender_path[i];
			const current_segment = current_path[i];

			// contender shorter than current and all previous segments equal -> earlier
			if (contender_segment === undefined) return;
			// current shorter than contender and all previous segments equal -> contender is later
			if (current_segment === undefined || contender_segment > current_segment) {
				this.#title.path = value.path;
				this.#title.value = value.value;
				return;
			}
			if (contender_segment < current_segment) return;
			// else equal -> continue
		}
		// paths are equal -> keep current value (do nothing)
	}

	/**
	 * @param {() => string} uid
	 */
	constructor(uid) {
		this.#uid = uid;
		this.#css = new Set();
		this.#title = { path: [], value: '' };
	}

	copy() {
		const head_state = new TreeHeadState(this.#uid);
		head_state.#css = new Set(this.#css);
		head_state.#title = this.title;
		return head_state;
	}

	/**
	 * @param {TreeHeadState} other
	 */
	subsume(other) {
		this.#css = other.#css;
		this.#title = other.#title;
		this.#uid = other.#uid;
	}
}

/**
 * Creates an ID generator
 * @param {string} prefix
 * @returns {() => string}
 */
function props_id_generator(prefix) {
	let uid = 1;
	return () => `${prefix}s${uid++}`;
}
