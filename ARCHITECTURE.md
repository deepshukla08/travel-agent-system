# Production architecture note — Azure, 500+ concurrent users

## Provisioning

Bicep modules, deployed per environment through GitHub Actions with OIDC federated
credentials, so no cloud secrets are stored in CI.

## Compute

**Azure Container Apps** for the API. A run holds an SSE connection open for 30–90 seconds,
which rules out Functions' consumption timeouts. Scale on the KEDA HTTP concurrency rule at
roughly 40 in-flight requests per replica — 500 concurrent runs means about 12–15 replicas —
with `minReplicas: 2` so nobody pays a cold start. The frontend is a **Static Web App** on
the global CDN.

The real ceiling is model throughput, not CPU. Past a few hundred concurrent runs I would put
requests on a **Service Bus** queue, return a run id immediately, and stream progress from a
worker, so a provider 429 becomes queue latency rather than a failed request.

## Data and secrets

SQLite becomes **Azure Database for PostgreSQL Flexible Server** — the same two tables, with
`agent_runs` append-only. **Key Vault** holds model keys, read via managed identity, so no
credentials sit in environment variables.

## Authentication and access control

**Entra ID**, authorisation-code flow with PKCE from the SPA. The API validates the JWT and
authorises on **App Roles** — `traveller` versus `auditor` — mapped from Entra groups. The
audit view requires `auditor`, replacing today's forgeable `x-user-role` header at exactly the
same point in the request path. **API Management** in front adds per-subscription rate limits
and token quotas.

## Monitoring

**Application Insights** with OpenTelemetry. One distributed trace per run, correlating all
three agent calls under the run id, with custom dimensions for agent, model served, latency
and guards fired. Alerts on guard-fire rate, 429 rate and p95 run duration — a rising
guard-fire rate means the model is drifting against the constraints, which is the signal worth
paging on.
