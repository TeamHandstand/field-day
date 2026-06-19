import { describe, expect, it } from "vitest";
import { canResetAdminPasswords, DEFAULT_RESET_PASSWORD } from "./permissions";

describe("canResetAdminPasswords", () => {
  it("allows the allowlisted admin", () => {
    expect(canResetAdminPasswords("sam@handstandwith.us")).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(canResetAdminPasswords("  SAM@Handstandwith.us ")).toBe(true);
  });

  it("rejects non-allowlisted admins", () => {
    expect(canResetAdminPasswords("someone-else@handstandwith.us")).toBe(false);
  });

  it("rejects missing email", () => {
    expect(canResetAdminPasswords(null)).toBe(false);
    expect(canResetAdminPasswords(undefined)).toBe(false);
    expect(canResetAdminPasswords("")).toBe(false);
  });

  it("exposes the default reset password", () => {
    expect(DEFAULT_RESET_PASSWORD).toBe("loveya");
  });
});
