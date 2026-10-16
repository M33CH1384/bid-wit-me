/** Spectate (`?watch=1`) goes straight in. Joining still needs a saved display name. */
export function canEnterTable(code: string | null, savedName: string, search: string): boolean {
  if (!code) return false;
  if (savedName.trim()) return true;
  return new URLSearchParams(search).has('watch');
}

/** Name sent with the table hello. A spectator who never picked one is just Guest. */
export function tableEntryName(typed: string, search: string): string {
  const name = typed.trim().slice(0, 20);
  if (name) return name;
  return new URLSearchParams(search).has('watch') ? 'Guest' : 'Player';
}
