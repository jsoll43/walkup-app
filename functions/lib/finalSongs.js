export function finalSongKeys(
  team,
  playerId,
  { includeGlobalLegacy = team.slug === "default" } = {}
) {
  return [
    `final/${team.id}/${playerId}`,
    `final/${team.slug}/${playerId}`,
    ...(includeGlobalLegacy ? [`final/${playerId}`] : []),
  ];
}

async function findFinalSongWithMethod(
  bucket,
  team,
  playerId,
  { prefixFallback = false, includeGlobalLegacy = team.slug === "default" } = {},
  method = "get"
) {
  const teamKeys = finalSongKeys(team, playerId, { includeGlobalLegacy: false });
  for (const key of teamKeys) {
    const object = await bucket[method](key);
    if (object) return { object, key };
  }

  if (prefixFallback) {
    for (const prefix of teamKeys) {
      const found = await findPrefixedSong(bucket, prefix, method);
      if (found) return found;
    }
  }

  if (includeGlobalLegacy) {
    const legacyKey = `final/${playerId}`;
    const object = await bucket[method](legacyKey);
    if (object) return { object, key: legacyKey };
    if (prefixFallback) return findPrefixedSong(bucket, legacyKey, method);
  }

  return null;
}

export async function findFinalSong(bucket, team, playerId, options = {}) {
  return findFinalSongWithMethod(bucket, team, playerId, options, "get");
}

export async function findFinalSongMetadata(bucket, team, playerId, options = {}) {
  return findFinalSongWithMethod(bucket, team, playerId, options, "head");
}

async function findPrefixedSong(bucket, prefix, method = "get") {
  let cursor;
  do {
    const listed = await bucket.list({ prefix, cursor });
    const match = (listed.objects || []).find(({ key }) =>
      key === prefix || key.startsWith(`${prefix}.`)
    );
    if (match?.key) {
      const object = await bucket[method](match.key);
      if (object) return { object, key: match.key };
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return null;
}

export async function getFinalSongStatus(bucket, team, players = []) {
  if (!bucket) return {};

  const status = {};
  for (const prefixValue of [team.id, team.slug]) {
    const prefix = `final/${prefixValue}/`;
    let cursor;
    do {
      const listed = await bucket.list({ prefix, cursor });
      for (const object of listed.objects || []) {
        const playerId = object.key.slice(prefix.length).split(".")[0];
        if (playerId) status[playerId] = true;
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  if (team.slug === "default") {
    for (const player of players) {
      if (!status[player.id] && await bucket.head(`final/${player.id}`)) {
        status[player.id] = true;
      }
    }
  }

  return status;
}
