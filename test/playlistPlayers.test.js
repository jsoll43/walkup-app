import assert from "node:assert/strict";
import test from "node:test";
import { removeDuplicatePlayers } from "../src/audio/playlistPlayers.js";

test("deduplicates across teams and jersey numbers while keeping the first team entry", () => {
  const preferred = { id: "a", teamSlug: "gold", name: "#12 Alex Smith" };
  const otherPlayer = { id: "b", teamSlug: "gold", name: "#8 Alex Jones" };
  const guest = { id: "c", teamSlug: "blue", name: "#99  ALEX   Smith " };
  const tracks = [preferred, otherPlayer, guest];
  assert.deepEqual(removeDuplicatePlayers(tracks), [preferred, otherPlayer]);
  assert.equal(tracks.length, 3);
  assert.deepEqual(removeDuplicatePlayers([guest, preferred]), [guest]);
});

test("uses stored full names when available and handles an empty playlist", () => {
  const first = { id: "a", teamSlug: "gold", name: "#1 Alex Smith", fullName: "Alex Smith" };
  const guest = { id: "b", teamSlug: "blue", name: "#2 Alex Smith", fullName: " Alex Smith " };
  assert.deepEqual(removeDuplicatePlayers([first, guest]), [first]);
  assert.deepEqual(removeDuplicatePlayers([]), []);
});
