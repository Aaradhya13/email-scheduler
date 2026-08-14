import { GoogleIcon } from '../components/Icons'
import { startGoogleLogin } from '../lib/api'

export default function LoginPage() {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Login</h1>
        <button className="google-button" type="button" onClick={startGoogleLogin}>
          <GoogleIcon className="google-icon" />
          Login with Google
        </button>

        <div className="divider">
          <span />
          <p>or sign up through email</p>
          <span />
        </div>

        <input className="login-input" type="email" placeholder="Email ID" disabled />
        <input
          className="login-input"
          type="password"
          placeholder="Password"
          disabled
        />
        <button className="primary-login-button" type="button" disabled>
          Login
        </button>
      </div>
    </div>
  )
}
