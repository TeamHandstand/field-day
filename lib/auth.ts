import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const admin = await prisma.admin.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });
        if (!admin) return null;
        const ok = await bcrypt.compare(credentials.password, admin.hashedPassword);
        if (!ok) return null;
        return { id: admin.id, email: admin.email, name: admin.name ?? null };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.email = (user as { email?: string | null }).email ?? token.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (token.id) (session.user as { id?: string }).id = token.id as string;
        if (token.email) session.user.email = token.email as string;
      }
      return session;
    },
  },
};
