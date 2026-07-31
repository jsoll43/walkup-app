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

export async function findFinalSong(
  bucket,
  team,
  playerId,
  { prefixFallback = false, includeGlobalLegacy = team.slug === "default" } = {}
) {
  const teamKeys = finalSongKeys(team, playerId, { includeGlobalLegacy: false });
  for (const key of teamKeys) {
    const object = await bucket.get(key);
    if (object) return { object, key };
  }

  if (prefixFallback) {
    for (const prefix of teamKeys) {
      const found = await findPrefixedSong(bucket, prefix);
      if (found) return found;
    }
  }

  if (includeGlobalLegacy) {
    const legacyKey = `final/${playerId}`;
    const object = await bucket.get(legacyKey);
    if (object) return { object, key: legacyKey };
    if (prefixFallback) return findPrefixedSong(bucket, legacyKey);
  }

  return null;
}

async function findPrefixedSong(bucket, prefix) {
  let cursor;
  do {
    const listed = await bucket.list({ prefix, cursor });
    const match = (listed.objects || []).find(({ key }) =>
      key === prefix || key.startsWith(`${prefix}.`)
    );
    if (match?.key) {
      const object = await bucket.get(match.key);
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
