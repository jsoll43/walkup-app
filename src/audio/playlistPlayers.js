export function removeDuplicatePlayers(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    // Older saved playlists only have a display name, which may include a jersey number.
    const name = (track.fullName || track.name.replace(/^#\S+\s+/, ""))
      .normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    const key = name || `${track.teamSlug}/${track.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
