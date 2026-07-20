import { Radar } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Label } from '../components/Label';
import { useToast } from '../components/Toast';

const isDev = import.meta.env.DEV;

interface DesktopErrorLike {
  code?: string;
  message?: string;
}

function errorMessage(error: unknown): string {
  const candidate = error as DesktopErrorLike;
  if (candidate && typeof candidate.message === 'string' && candidate.message.length > 0) {
    return candidate.message;
  }
  return 'Sign-in failed. Check the server URL and your credentials.';
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({
        username: username.trim(),
        password,
        serverUrl: isDev && serverUrl.trim() ? serverUrl.trim() : undefined,
      });
      toast('Signed in successfully');
      const target = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(target, { replace: true });
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-navy px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Radar className="h-9 w-9 text-primary" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-slate-900">Nepal Passport Helper</h1>
          <p className="text-sm text-slate-500">Sign in to start watching for slots</p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate={false}>
          {isDev && (
            <div>
              <Label htmlFor="server-url">Server URL (dev)</Label>
              <Input
                id="server-url"
                type="url"
                placeholder="http://localhost:8000"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                autoComplete="url"
              />
            </div>
          )}
          <div>
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" loading={submitting} disabled={!username.trim() || !password}>
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
