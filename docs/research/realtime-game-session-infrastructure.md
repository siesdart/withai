# Real-time game-session infrastructure: research findings

**Scope.** This note records documented options and constraints for the Mafia
vertical slice. It deliberately makes no technology selection. The inspected
baseline is NestJS 11 on the Express platform and a Vite/React client; neither
application currently declares a real-time transport, persistence store, job
queue, cookie parser, LLM SDK, or deployment provider.

## The server-authoritative contract

The game server can make a phase deadline the authority (`phaseEndsAt`) and
emit an ordered public event stream (phase changed, message posted, vote
accepted, resolution published). A browser should send only authenticated-for-
the-session commands; it must not be allowed to advance a phase or resolve an
action.

Nest supports process-local scheduled work. `ScheduleModule.forRoot()`
registers declarative jobs at application bootstrap, and `SchedulerRegistry`
can dynamically add, retrieve, and delete named JavaScript timeouts and
intervals. That makes it compatible with per-game phase deadlines and
agent-message delays. [Nest task scheduling](https://docs.nestjs.com/techniques/task-scheduling)

The scheduler API registers JavaScript timers in the running application
process. Consequently, the following is an inference—not an automatic Nest
guarantee: a process restart loses those timers, and multiple API replicas can
each schedule the same deadline unless the authoritative session state and a
single-executor/claim mechanism are externalized. Persisting a deadline and
validating it atomically at execution is therefore the relevant recovery and
horizontal-scaling requirement.

## Browser live-update choices

### WebSocket gateway

Nest gateways provide an event-oriented WebSocket server. Socket.IO is the
default gateway platform; the official `WsAdapter` is an alternative based on
the native `ws` package. Socket.IO's Nest packages are additional dependencies
(`@nestjs/websockets` and `@nestjs/platform-socket.io`), while `WsAdapter` is
configured explicitly. [Nest gateways](https://docs.nestjs.com/websockets/gateways)
[Nest adapters](https://docs.nestjs.com/websockets/adapter)

WebSocket permits commands and pushed events on one connection. This fits chat
submission plus game updates. Event sequencing, snapshots/catch-up and output
coalescing remain application responsibilities; those are not provided by the
protocol itself. [WebSocket standard](https://websockets.spec.whatwg.org/)

If Socket.IO uses polling in a multi-instance deployment, Nest documents that
the load balancer needs cookie-based routing, or polling must be disabled by
using WebSocket-only transport; Redis alone does not solve that routing
requirement. [Nest Socket.IO adapter scaling](https://docs.nestjs.com/websockets/adapter)

### Server-Sent Events plus HTTP commands

Nest can expose an `@Sse()` route that returns an RxJS `Observable` of
`MessageEvent` values; the browser connects using `EventSource` over a
`text/event-stream` response. [Nest SSE](https://docs.nestjs.com/techniques/server-sent-events)

SSE is server-to-browser only, so chat, vote, and role-action submissions would
remain ordinary HTTP mutations. The EventSource standard defines reconnecting
after a connection failure and transmits the last event ID in the
`Last-Event-ID` header when it is non-empty. This makes it a viable shape for
an authoritative event stream, provided the server retains enough ordered
events (or can send a fresh snapshot) after a reconnect.
[HTML EventSource standard](https://html.spec.whatwg.org/multipage/server-sent-events.html)

Both choices work with the existing Vite/React client without a mandatory
transport library. React documents creating an external connection in an
Effect and disconnecting it from the cleanup function, which maps naturally to
a game-session subscription hook. [React `useEffect`](https://react.dev/reference/react/useEffect)

## Agent scheduling and LLM-cost control

An event-driven scheduler can create an agent decision only after a committed
public event, retain the game/version it was based on, and re-check that version
and phase before publishing the delayed response. This is a recommended design
consequence of the authoritative contract, not functionality a Nest transport
supplies. Dynamic Nest timers are sufficient for a single live process; an
external durable queue or timer store becomes a separate decision if restart
recovery or multiple replicas are required.

Every LLM request should be server initiated. A per-session budget, phase
message cap, agent cooldown, cancellation when a phase changes, and a server
side idempotency key are transport-independent controls that bound cost even
when browsers reconnect or submit a command twice.

## Short-lived persistence options

1. **In-process sessions.** No new service is needed, and dynamic timers match
   the model. State, quotas, and replay vanish on restart and cannot safely be
   shared among replicas; this confines limited beta to a single API process.
2. **A durable database with expiry.** Persisting session state/events,
   deadlines, and anonymous quota counters enables recovery and replay expiry.
   The concrete database and its transaction/expiry semantics remain an open
   decision.
3. **A TTL-capable key-value store.** Redis's `EXPIRE` associates a timeout
   with a key; expired keys are deleted, and `TTL` reports remaining lifetime.
   That directly supports an ephemeral session/replay/quota record, but expiry
   is deletion rather than an application-level finalization workflow.
   [Redis `EXPIRE`](https://redis.io/docs/latest/commands/expire/)

For later multi-instance fan-out, Redis Pub/Sub has **at-most-once** delivery:
   a disconnected subscriber loses messages. Redis Streams persist messages and
   support consumer groups, but add acknowledgement/retention design work.
   This distinction matters if the live feed cannot always be rebuilt from the
   authoritative event store. [Redis Pub/Sub](https://redis.io/docs/latest/develop/pubsub/)
   [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/)

## Anonymous guest quota and session identity

Nest's Express integration supports reading parsed cookies through
`request.cookies` and signed cookies through `request.signedCookies`, with the
cookie parser middleware configured separately. [Nest cookies](https://docs.nestjs.com/techniques/cookies)
The server can issue an opaque, signed guest identifier in an `HttpOnly`,
`Secure` cookie and keep the daily count in server-side state keyed by that
identifier. `HttpOnly` prevents JavaScript access; `Secure` restricts delivery
to HTTPS; `SameSite` controls cross-site sending behavior. [HTTP State Management Mechanism](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis)

A guest can delete or change browsers, so a cookie quota alone is a cost guard,
not a hard abuse boundary. IP is only a supplementary signal behind a proxy:
Nest documents configuring Express `trust proxy` so the application reads the
correct client address. Its throttler module is available for request-rate
limits, which are distinct from a "ten game creations per day" business quota.
[Nest rate limiting](https://docs.nestjs.com/security/rate-limiting)

## Limited-beta deployment implications

No provider is selected in this research. Whichever one is chosen must keep the
API process available for long-lived WebSocket/SSE connections and ensure its
proxy/load-balancer behavior matches the selected transport. A single instance
permits in-memory sessions but loses active games on restart. Multiple replicas
require a shared source of truth for session state, deadline ownership, quota,
and reconnect catch-up; Socket.IO polling additionally has the documented
affinity constraint above.

## Decisions this research enables

- Choose one client transport: bidirectional WebSocket or SSE for events plus
  HTTP commands.
- Decide whether the beta may be single-process/volatile, or needs durable
  short-lived state before deployment.
- If durable/multi-instance support is needed, decide the authoritative store,
  expiry/replay policy, deadline executor, and event catch-up protocol together.
- Decide the guest identifier cookie policy and the server-side store used to
  count daily game creation.
