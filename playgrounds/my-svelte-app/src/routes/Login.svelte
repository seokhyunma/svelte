<script>
  import { login } from '../stores';
  import { push } from 'svelte-spa-router';
  let username = "";
  let password = "";
  let error = "";

  function handleLogin() {
    try {
      login(username, password);
      push("/home");
    } catch (e) {
      error = e.message;
    }
  }
</script>

<h1>로그인</h1>
{#if error}<p style="color:red">{error}</p>{/if}

<input placeholder="아이디" bind:value={username} />
<input type="password" placeholder="비밀번호" bind:value={password} />

<button on:click={handleLogin}>로그인</button>
<a href="#/signup">회원가입</a>

