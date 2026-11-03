export function cx(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}
