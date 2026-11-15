# Work spatial data management

The production project remains owner-private:
appgprj_6aedb2ae0c208191ab014ed6d81f2125.

## Server boundary

Sites dispatch authenticates the request before the Worker. Browser visits carry
dispatch-injected oai-authenticated-user-* headers. Official Sites service bearer
access is validated and consumed by dispatch and has no visitor identity.

The server rejects spatial changes from any request containing visitor identity,
Origin, or any Sec-Fetch-* header. Enforcement compares the transaction's old and
new physical entities, spatial states/memberships, and relations whose two ends
are physical spaces. It covers creation, edit, deletion, restore, merge, split,
and backup restore. Backup checks run before the R2 safety write. Normal
character/event references to an existing planet remain available.

This is the existing Sites authenticated-service path, not an independently
verified Work application identity. The Worker cannot independently prove the
Site's current audience. Every publication must verify owner-only access before
and after publishing. This implementation must not be deployed as a public or
shared Site without a separate server-side capability design.

## Supported management procedure

1. Read get_site for this exact project and verify owner-only access.
2. Obtain its existing service access credential using the official Sites tool.
   Do not create/rotate access merely to inspect it.
3. Use the same Site's API with OAI-Sites-Authorization: Bearer and the credential
   kept in process memory. Do not send browser visitor headers or store secrets
   in source, prompts, archives, browser JavaScript, or local files.
4. Read /api/backup and the current entity/revision before modifying data.
5. Use the existing /api/entities API with its current revision and merged data.
   Keep the existing ID and references. Relationships/states use their existing
   guarded collection APIs.
6. Read back the changed record and related references. Retain the backup and
   revision history. Conflicts must be reviewed, never force-written.
7. Restoring spatial data uses the same authenticated service path and existing
   backup safeguards, including the R2 safety backup.

Direct local Store/CLI administration remains available in Work. The compatibility
Python server applies the same browser-versus-service request distinction; local
administration must remain on the managed private/loopback environment.

## Current verification limit

The native Sites database tools currently expose read-only overview and row
paging. There is no native SQL/D1 write tool in this session. The managed Cloud
policy does not allow the Site hostname, so end-to-end service API management is
currently unverified. Do not bypass the proxy, network policy or sandbox to test
it. The API boundary is covered by isolated SQLite tests.

R2 inventory/export access is unavailable. This redesign does not create, edit,
delete or move R2 objects or change its binding. Existing backup/restore behavior
is retained, with denied browser spatial restores rejected before any R2 write.
