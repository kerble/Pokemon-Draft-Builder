// Per-species movepool tweaks applied on top of Showdown's Gen 9 learnset
// data. Use this when your league's move-legality differs from Showdown's SV
// dex — most often to allow a Gen 8 transfer move Showdown doesn't grant in
// SV (e.g. Latios / Latias + Mystical Fire), or for a not-yet-in-Showdown
// release. Same idea as adding sets to gen9_filtered.js by hand.
//
// Keys are canonical Showdown species names (what names.js resolves to):
// "Latios", "Samurott-Hisui", "Meganium-Mega". Move names must match
// Showdown's moves.json display names exactly.

export const MOVEPOOL_OVERRIDES = {
  Latios: { add: ['Mystical Fire'], remove: [] },
  Latias: { add: ['Mystical Fire'], remove: [] },
};
