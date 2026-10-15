import { LoginForm } from "@/components/LoginForm";
import { signIn } from "../actions";

export const metadata = { title: "Sign in · Outreach Tracker" };

export default function LoginPage() {
  return (
    <main className="login">
      <LoginForm action={signIn} />
    </main>
  );
}
