<script>
  import Router from 'svelte-spa-router';
  import Login from './routes/Login.svelte';
  import Signup from './routes/Signup.svelte';
  import Home from './routes/Home.svelte';

  const routes = {
    "/": Login,
    "/login": Login,
    "/signup": Signup,
    "/home": Home,
  };
</script>

<Router {routes} />

npm run dev


