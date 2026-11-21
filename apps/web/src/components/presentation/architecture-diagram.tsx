import type { Copy } from '@/lib/presentation-content';
// Drawn from infra/hosting (aws-runtime.py, entrypoint.mjs, nginx.conf, Dockerfile) and apps/api/src/worker.ts.
// Plain CSS boxes so it stays readable on a phone and needs no external image.
function Box({ title, text, tone = 'white', id }: { title: string; text?: string | undefined; tone?: 'white' | 'green' | 'amber' | 'sky'; id?: string }) {
  const tones = {
    white: 'border-slate-300 bg-white', green: 'border-emerald-600 bg-emerald-50',
    amber: 'border-amber-500 bg-amber-50', sky: 'border-sky-600 bg-sky-50',
  } as const;
  return (
    <div data-node={id} className={`min-w-0 rounded-xl border-2 px-3 py-2 ${tones[tone]}`}>
      <p className="break-words text-sm font-semibold text-slate-900 md:text-base">{title}</p>
      {text ? <p className="break-words text-xs text-slate-600 md:text-sm">{text}</p> : null}
    </div>
  );
}
const Arrow = ({ label }: { label?: string }) => (
  <p aria-hidden="true" className="text-center text-lg leading-none text-slate-500">↓{label ? <span className="ml-1 text-xs">{label}</span> : null}</p>
);
export function ArchitectureDiagram({ labels }: { labels: Copy['tech']['labels'] }) {
  return (
    <div role="group" aria-label="AWS architecture" data-testid="architecture" className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Box id="browser" title={`🖥️ ${labels.browser}`} text={labels.users} />
        <Box id="line-app" title={`💬 ${labels.line}`} text={labels.oa} tone="green" />
      </div>
      <Arrow label="HTTPS" />
      <Box id="express" title={labels.express} tone="sky" text="ap-southeast-1" />
      <Arrow />
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-2 rounded-xl border-2 border-dashed border-sky-600 p-2">
          <p className="text-xs font-semibold text-sky-800 md:text-sm">{labels.appTask}</p>
          <Box id="nginx" title={labels.nginx} text="/webhooks/line/* · /" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Box id="next" title={labels.next} text="Dashboard · /presentation" />
            <Box id="api" title={labels.api} text="/api/* · webhooks" />
          </div>
        </div>
        <div className="rounded-xl border-2 border-dashed border-sky-600 p-2">
          <p className="mb-2 text-xs font-semibold text-sky-800 md:text-sm">{labels.worker}</p>
          <Box id="worker" title="worker" text={labels.workerText} />
        </div>
      </div>
      <Arrow />
      <div className="grid gap-2 sm:grid-cols-3">
        <Box id="rds" title={`🗄️ ${labels.db}`} text={labels.dbText} tone="amber" />
        <Box id="bedrock" title={`🧠 ${labels.bedrock}`} text={labels.bedrockText} tone="amber" />
        <Box id="line-api" title={`✉️ ${labels.linePush}`} text="reply / push" tone="green" />
      </div>
      <div className="grid gap-2 pt-1 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-600">{labels.buildTitle}</p>
          <p data-node="build" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs md:text-sm">{labels.build} → {labels.ecr} → ECS</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-600">{labels.supportTitle}</p>
          <p data-node="support" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs md:text-sm">{labels.secrets} · {labels.logs}</p>
        </div>
      </div>
    </div>
  );
}
