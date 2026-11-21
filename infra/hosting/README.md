# Agrimatch AWS hosting

Owner authorized deployment to the Hackathon AWS account on 18 November 2026.
Region: `ap-southeast-1`. Provisioning has usage charges; resources are not automatically deleted.

## Layout

- ECS Express Mode provides the public HTTPS endpoint and a managed load balancer/certificate.
- One Fargate application task runs API, Next.js and a small nginx gateway together. This keeps the existing Next.js same-origin `/api` rewrite intact and gives LINE the original `/webhooks/line/*` paths.
- The worker is a separate ECS service. Its initial desired count is zero because this code snapshot does not register a `line_event` handler. Starting it now would mark incoming jobs DEAD/NO_HANDLER.
- RDS PostgreSQL 16, Single-AZ, `db.t4g.micro`, 20 GiB gp3, encrypted storage, seven-day backups and deletion protection. It has no public address; port 5432 accepts only the application security group.
- A one-off migration task uses the database owner. Application/worker tasks use `agrimatch_app`, which has DML access but cannot create schema objects, modify migration records, or truncate the append-only ledgers.
- Runtime credentials are stored in AWS Secrets Manager and injected into tasks. AWS access comes from a task role. No AWS SSO cache or static AWS access key is copied to the image.
- The task's Bedrock policy was generated with IAM Policy Autopilot. A separate permissions boundary limits effective access to `bedrock:InvokeModel` on `anthropic.claude-sonnet-5` in Singapore.
- Application steady-state scaling is limited to one task. Deployment replacement tasks can overlap temporarily.

## Files and private state

`Dockerfile`, `nginx.conf`, `entrypoint.mjs`, `migrate.mjs` and `verify.mjs` contain deployment plumbing only. Existing business source and tests are unchanged.

The root `.dockerignore` sends only application/build inputs and excludes `.env`, dependencies, test folders, build output and hosting private/state folders. The root `.gitignore` excludes:

- `infra/hosting/private/`: generated hosted credentials and private Docker sign-in config.
- `infra/hosting/state/`: identifiers, task revisions and cloud state for resuming operations.

Do not copy private/state folders into a deliverable or commit. `.env` remains the local development configuration. Hosted DATABASE_URL and SESSION_SECRET are separate values.

## Build and publish

Run from the repository root:

```sh
python infra/hosting/aws-runtime.py build
python infra/hosting/aws-runtime.py build-status
```

The build uploads an allowlisted source snapshot to the private source bucket. CodeBuild builds and pushes the immutable image within AWS. Poll `build-status` until SUCCEEDED; it records the exported image URI in `infra/hosting/state/aws.json`. Use that exact `image_uri` below. Runtime credentials are not included in the source archive or build environment.

```sh
python infra/hosting/aws-runtime.py register <uploaded-image-uri>
python infra/hosting/aws-runtime.py migrate
python infra/hosting/aws-runtime.py status
```

Wait until the migration task is STOPPED with exit code 0. A nonzero exit is a blocker; do not bypass it.

```sh
python infra/hosting/aws-runtime.py publish
python infra/hosting/aws-runtime.py status
```

The first startup has a temporary invalid WEB_ORIGIN while AWS assigns the real hostname. `status` records the returned public HTTPS endpoint in state. Then register and publish once more with the same image so the public WEB_ORIGIN is exact. This does not recreate the database or copy local app data.

```sh
python infra/hosting/aws-runtime.py register <same-uploaded-image-uri>
python infra/hosting/aws-runtime.py publish
python infra/hosting/aws-runtime.py status
```

Subsequent deployments keep the assigned origin. Run migrations first whenever the image adds migrations.

## Verification

```sh
python infra/hosting/aws-runtime.py verify
python infra/hosting/check-http.py <actual-public-https-url>
```

The one-off verification task checks the restricted database role, real Bedrock using the task role and the three LINE tokens. It sends only a synthetic READY prompt to Bedrock and reads LINE bot information; it sends no user messages.

The HTTP check validates TLS, health, login rendering, same-origin unauthenticated `/api/me` (401), and all three LINE paths with signed empty events (200) and unsigned events (401). An empty verification request does not enqueue a chat message.

LINE endpoint URLs can be set and verified with `python infra/hosting/configure-line.py` while Use webhook is off. The script refuses an already active webhook and never enables live traffic.

## Handoff to Kiro

1. Read the current deployment handoff under `docs/` for the actual URLs and verified status.
2. Finish and wire the `line_event` handlers before starting the worker or enabling live webhook traffic.
3. Redeploy a fresh immutable image containing those handlers, then update the worker service to that task revision and desired count 1.
4. Check LINE auto-reply/greeting settings before testing chat, to avoid duplicate default replies.
5. Enable AI/vision only with the appropriate settings after testing. Initial hosted `AI_MODE=disabled` and `VISION_ENABLED=false` keep the unfinished conversation flow quiet while infrastructure is prepared; the real Bedrock adapter and task-role connectivity are checked separately.
6. Seed synthetic demo organizations and login accounts using the app's intended seed path. No real user database was copied into RDS.

There is deliberately no delete/reset command. To stop or delete paid resources later, review the current service/database state and get the owner's instruction; preserve the database or take a snapshot first.

## AWS documentation used

- [ECS Express Mode](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html)
- [Custom task definitions and HTTPS endpoints](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-getting-started.html)
- [ECS task IAM roles](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)
- [RDS PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html)
