import { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { QuiverLogo } from '@/components/Logo';
import { Button, IconButton } from '@/components/ui/Button';
import { setWebToken } from '@/lib/web';

export function WebUnlock({
  notice,
  onUnlocked,
}: {
  notice?: string | null;
  onUnlocked: () => void;
}) {
  const [token, setToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    const value = token.trim();
    if (!value) {
      setError('请输入桌面端设置中显示的访问 Token。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/health', {
        headers: { 'X-Quiver-Token': value },
        cache: 'no-store',
      });
      if (response.status === 401) {
        setError('Token 不正确，请在桌面端「设置 → 本地 Web 服务」中核对后重试。');
        return;
      }
      if (!response.ok) {
        setError(`本地服务拒绝了请求（HTTP ${response.status}）。`);
        return;
      }
      setWebToken(value);
      onUnlocked();
    } catch {
      setError('无法连接本地 Web 服务，请确认 Quiver 桌面端正在运行并已开启 Web 服务。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full min-h-screen items-center justify-center overflow-hidden bg-void px-6 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          background:
            'radial-gradient(720px 420px at 50% -10%, color-mix(in srgb, var(--color-fg) 6%, transparent), transparent 70%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative w-full max-w-[420px]"
      >
        <div className="mb-5 flex items-center gap-2.5">
          <QuiverLogo className="h-7 w-7 rounded-[7px]" />
          <span className="text-[16px] font-semibold tracking-[-0.01em] text-fg">
            Quiver
          </span>
          <span className="rounded-[4px] border border-hairline bg-soft px-1.5 py-0.5 font-mono text-[13px] text-fg-subtle">
            本地 Web
          </span>
        </div>

        <div className="rounded-[13px] border border-hairline bg-raised p-5 shadow-float">
          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-hairline bg-soft text-fg-muted">
            <Globe2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </span>
          <h1 className="mt-3 text-[18px] font-semibold tracking-[-0.01em] text-fg">
            解锁本地 Web 界面
          </h1>
          <p className="mt-1 text-[14px] leading-relaxed text-fg-subtle">
            此页面连接本机回环地址上的 Quiver 引擎。请输入桌面端「设置 → 本地 Web 服务」中显示的访问
            Token。
          </p>

          <label className="mt-4 block">
            <span className="flex items-center gap-1.5 text-[14px] text-fg-muted">
              <KeyRound className="h-3 w-3 text-fg-subtle" strokeWidth={1.8} />
              访问 Token
            </span>
            <span className="relative mt-1.5 block">
              <input
                autoFocus
                type={visible ? 'text' : 'password'}
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit();
                }}
                aria-label="访问 Token"
                aria-invalid={Boolean(error)}
                autoComplete="off"
                spellCheck={false}
                placeholder="粘贴 48 位十六进制 Token"
                className="h-9 w-full rounded-[6px] border border-hairline bg-soft pl-3 pr-10 font-mono text-[13px] text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-hairline-strong"
              />
              <IconButton
                label={visible ? '隐藏 Token' : '显示 Token'}
                onClick={() => setVisible((value) => !value)}
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
              >
                {visible ? (
                  <EyeOff className="h-3 w-3" strokeWidth={1.8} />
                ) : (
                  <Eye className="h-3 w-3" strokeWidth={1.8} />
                )}
              </IconButton>
            </span>
          </label>

          {error || notice ? (
            <p
              role="alert"
              className="mt-2 rounded-[6px] border border-rose/[0.16] bg-rose/[0.04] px-2.5 py-1.5 text-[13px] leading-relaxed text-rose/90"
            >
              {error ?? notice}
            </p>
          ) : null}

          <Button
            size="md"
            variant="primary"
            loading={busy}
            onClick={() => void submit()}
            className="mt-3 w-full gap-1.5"
          >
            {busy ? '正在验证…' : '解锁'}
            {busy ? null : <ArrowRight className="h-3 w-3" strokeWidth={1.9} />}
          </Button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-[8px] border border-hairline bg-soft/60 px-3 py-2.5">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-jade/80" strokeWidth={1.8} />
          <p className="text-[13px] leading-relaxed text-fg-faint">
            Token 只保存在当前浏览器会话中，所有 API 请求都必须携带该 Token；关闭标签页后需要重新输入。
          </p>
        </div>

        <p className="mt-3 truncate font-mono text-[13px] text-fg-faint">
          当前地址 {typeof window === 'undefined' ? '' : window.location.origin}
        </p>
      </motion.div>
    </div>
  );
}
