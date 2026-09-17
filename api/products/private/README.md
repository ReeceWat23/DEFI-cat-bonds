# Private products

Empty in Iteration 1 of the "Deployed Triggers as Source of Truth" sprint
(`api/it3_plan_triggers_n_mgmnt.md`). Private products — deals we sit
closer to, with a custom or third-party endpoint that isn't offered
publicly — get populated in Iteration 2 (§3.1), via the admin "Build / add
a trigger" flow (§3.3), which writes new definitions here at v1.

Same schema, same versioning rules as `../public/` — see `../README.md`.
The only difference is visibility: definitions here are only ever offered
to admin sessions on the Build a Bond page, never to public users.
