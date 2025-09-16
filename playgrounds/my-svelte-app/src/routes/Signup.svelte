<script>
  import { signup } from '../stores';
  import { push } from 'svelte-spa-router';
  let username = "";
  let password = "";
  let error = "";

  function handleSignup() {
    try {
      signup(username, password);
      push("/home");
    } catch (e) {
      error = e.message;
    }
  }
</script>

<h1>회원가입</h1>
{#if error}<p style="color:red">{error}</p>{/if}

<input placeholder="아이디" bind:value={username} />
<input type="password" placeholder="비밀번호" bind:value={password} />

<button on:click={handleSignup}>가입하기</button>
<a href="#/login">로그인</a>

