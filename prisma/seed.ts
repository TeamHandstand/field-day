import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("Skipping admin seed (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set).");
    return;
  }
  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin already exists for ${email}`);
    return;
  }
  const hashed = await bcrypt.hash(password, 10);
  await prisma.admin.create({
    data: { email, hashedPassword: hashed, name: "Admin" },
  });
  console.log(`Seeded admin ${email}`);
}

async function seedTemplates() {
  const existing = await prisma.activityTemplate.count({ where: { isSystemSeeded: true } });
  if (existing > 0) {
    console.log("System-seeded templates already present, skipping.");
    return;
  }

  await prisma.activityTemplate.create({
    data: {
      name: "Cross the Ocean",
      description: "Single timed run. Fastest team wins.",
      aggregationRule: "single",
      isSystemSeeded: true,
      subActivities: {
        create: [
          {
            name: "Cross the Ocean",
            displayOrder: 0,
            inputRule: "single_value",
            sortDirection: "asc",
            inputFields: {
              create: [{ label: "Time", unit: "seconds", displayOrder: 0 }],
            },
          },
        ],
      },
    },
  });

  await prisma.activityTemplate.create({
    data: {
      name: "Team Slingshot",
      description: "Single timed run. Fastest team wins.",
      aggregationRule: "single",
      isSystemSeeded: true,
      subActivities: {
        create: [
          {
            name: "Team Slingshot",
            displayOrder: 0,
            inputRule: "single_value",
            sortDirection: "asc",
            inputFields: {
              create: [{ label: "Time", unit: "seconds", displayOrder: 0 }],
            },
          },
        ],
      },
    },
  });

  await prisma.activityTemplate.create({
    data: {
      name: "Splash Zone",
      description: "Single weight measurement. Heaviest wins.",
      aggregationRule: "single",
      isSystemSeeded: true,
      subActivities: {
        create: [
          {
            name: "Splash Zone",
            displayOrder: 0,
            inputRule: "single_value",
            sortDirection: "desc",
            inputFields: {
              create: [{ label: "Weight", unit: "grams", displayOrder: 0 }],
            },
          },
        ],
      },
    },
  });

  await prisma.activityTemplate.create({
    data: {
      name: "Gut Check",
      description:
        "Composite challenge: Point North, Timer Test, Weight Test, Measurement Test. Lowest summed rank wins.",
      aggregationRule: "sum_of_ranks",
      isSystemSeeded: true,
      subActivities: {
        create: [
          {
            name: "Point North",
            displayOrder: 0,
            inputRule: "single_value",
            sortDirection: "asc",
            inputFields: {
              create: [{ label: "Degrees off North", unit: "degrees", displayOrder: 0 }],
            },
          },
          {
            name: "Timer Test",
            displayOrder: 1,
            inputRule: "sum_of_pct_deviation",
            sortDirection: "asc",
            inputFields: {
              create: [
                { label: "Attempt 1", unit: "seconds", defaultTargetValue: 30, displayOrder: 0 },
                { label: "Attempt 2", unit: "seconds", defaultTargetValue: 60, displayOrder: 1 },
                { label: "Attempt 3", unit: "seconds", defaultTargetValue: 90, displayOrder: 2 },
              ],
            },
          },
          {
            name: "Weight Test",
            displayOrder: 2,
            inputRule: "sum_of_pct_deviation",
            sortDirection: "asc",
            inputFields: {
              create: [
                { label: "Attempt 1", unit: "grams", displayOrder: 0 },
                { label: "Attempt 2", unit: "grams", displayOrder: 1 },
                { label: "Attempt 3", unit: "grams", displayOrder: 2 },
              ],
            },
          },
          {
            name: "Measurement Test",
            displayOrder: 3,
            inputRule: "sum_of_pct_deviation",
            sortDirection: "asc",
            inputFields: {
              create: [
                { label: "Attempt 1", unit: "cm", displayOrder: 0 },
                { label: "Attempt 2", unit: "cm", displayOrder: 1 },
                { label: "Attempt 3", unit: "cm", displayOrder: 2 },
              ],
            },
          },
        ],
      },
    },
  });

  console.log("Seeded 4 system activity templates.");
}

async function main() {
  await seedAdmin();
  await seedTemplates();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
