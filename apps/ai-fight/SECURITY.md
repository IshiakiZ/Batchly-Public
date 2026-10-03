# Execution boundaries

The web/ edition accepts source only inside disposable browser Workers. Workers are
created in an opaque-origin sandboxed iframe with connect-src none and restricted
script sources. A trusted outer broker terminates jobs after 20 seconds. Worker global
recovery does not grant access to the host page, account credentials or host storage.
Outputs can be forged and remain unranked; they are never authoritative leaderboard
scores. Worker timeouts limit hangs, but browsers do not provide a per-Worker hard memory
quota. Extremely memory-hungry code can still exhaust the visitor's browser process.

For the retained original local Node application:

This application was designed for one operator and two local coding agents. Its
filesystem folders are its ownership boundary. Browser host controls have no
account authentication, and the match state is shared by that local instance.

Never expose this server through a public tunnel or use it as a shared hosted
service. Never feed stranger-supplied JavaScript into its fighter or mode loaders.
The server intentionally binds to loopback. No hosted upload or MCP lane is added.

Node states that its VM module is not a security mechanism for untrusted code:
https://nodejs.org/api/vm.html

A public version requires explicit decisions about authenticated match membership,
actor ownership, persistent atomic quotas, a constrained strategy format or a
separately isolated execution service, replay access and deletion. Timeouts and
worker threads alone do not provide that isolation.
