import type { UserRole } from "@/types";

export function getRoleLabel(role: UserRole) {
  if (role === "super_admin") return "Super admin";
  if (role === "admin") return "Admin";
  if (role === "unit_leader") return "Dirigente unità";
  return "Partecipante";
}
