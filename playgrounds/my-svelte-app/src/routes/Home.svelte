<script>
  import { currentUser } from '../stores';
  import { $currentUser } from 'svelte/store';
</script>

<h1>홈 페이지</h1>
{#if $currentUser}
  <p>환영합니다, {$currentUser.username}!</p>
{:else}
  <p>로그인이 필요합니다.</p>
{/if}

