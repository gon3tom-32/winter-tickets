import { redirect } from "next/navigation";
import { getDb } from "@/lib/server-source";
import { requireStaff } from "@/lib/staff/session";
import { addStaff, deactivateStaff, listStaff, setRole } from "@/lib/staff/users";
import type { Role } from "@/lib/staff/auth";

const MESSAGES: Record<string, string> = {
  ok: "Staff member added. They can sign in with their email.",
  exists: "That email is already on the staff list.",
  bad_email: "Enter a valid email address.",
  denied: "Only admins can manage staff.",
  role: "Role changed.",
  off: "Account turned off and signed out.",
};

async function add(form: FormData) {
  "use server";
  const staff = await requireStaff("admin");
  const r = await addStaff(getDb()!, staff, String(form.get("email") ?? ""), (form.get("role") === "admin" ? "admin" : "staff") as Role);
  redirect(`/staff/users?msg=${r}`);
}
async function changeRole(form: FormData) {
  "use server";
  const staff = await requireStaff("admin");
  await setRole(getDb()!, staff, String(form.get("id")), (form.get("role") === "admin" ? "admin" : "staff") as Role);
  redirect("/staff/users?msg=role");
}
async function turnOff(form: FormData) {
  "use server";
  const staff = await requireStaff("admin");
  await deactivateStaff(getDb()!, staff, String(form.get("id")));
  redirect("/staff/users?msg=off");
}

export default async function Users({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const me = await requireStaff("admin");
  const { msg } = await searchParams;
  const people = await listStaff(getDb()!);
  return (
    <div className="wrap page">
      <h1>Staff</h1>
      {msg && MESSAGES[msg] && <p className="notice" role="status">{MESSAGES[msg]}</p>}
      <form action={add} className="panel add-staff">
        <label className="field">
          Email
          <input name="email" type="email" required />
        </label>
        <label className="field">
          Role
          <select name="role" defaultValue="staff">
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button className="button">Add</button>
      </form>
      <p className="muted small">
        Staff can comp seats, create codes (not free ones), turn codes off, and see the ledger and audit log. Admins can also
        create free codes, raise code limits, undo comps, and manage staff.
      </p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.userId} className={p.active ? "" : "inactive"}>
                <td>{p.email}{p.userId === me.userId && " (you)"}</td>
                <td>{p.role}</td>
                <td>{p.active ? "Active" : "Off"}</td>
                <td className="actions">
                  {p.active && p.userId !== me.userId && (
                    <>
                      <form action={changeRole}>
                        <input type="hidden" name="id" value={p.userId} />
                        <input type="hidden" name="role" value={p.role === "admin" ? "staff" : "admin"} />
                        <button className="link-button">Make {p.role === "admin" ? "staff" : "admin"}</button>
                      </form>
                      <form action={turnOff}>
                        <input type="hidden" name="id" value={p.userId} />
                        <button className="link-button">Turn off</button>
                      </form>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
