'use client';

import LoginForm from '../components/LoginForm';
import { useAuth } from '../components/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();

  return <LoginForm onLogin={login} />;
}
