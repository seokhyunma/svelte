
import { writable } from 'svelte/store';

export const currentUser = writable(null);

export function signup(username, password) {
  let users = JSON.parse(localStorage.getItem("users") || "[]");
  if (users.find(u => u.username === username)) {
    throw new Error("이미 존재하는 사용자입니다.");
  }
  users.push({ username, password });
  localStorage.setItem("users", JSON.stringify(users));
  currentUser.set({ username });
}

export function login(username, password) {
  let users = JSON.parse(localStorage.getItem("users") || "[]");
  const found = users.find(u => u.username === username && u.password === password);
  if (!found) {
    throw new Error("아이디 또는 비밀번호가 잘못되었습니다.");
  }
  currentUser.set({ username });
}
