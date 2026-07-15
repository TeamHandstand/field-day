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
  // Refresh the system-seeded templates on every run so NEW events always copy the
  // latest structure. Deleting a template sets Activity.templateId to NULL (SET NULL),
  // so events already created keep their own copied activities untouched.
  await prisma.activityTemplate.deleteMany({ where: { isSystemSeeded: true } });

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
              create: [{ label: "Weight", unit: "pounds", displayOrder: 0 }],
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
        "Composite challenge: Point North, Timer Test, Weight Test, Banana Split, Measurement Test. Lowest summed rank wins.",
      aggregationRule: "sum_of_ranks",
      isSystemSeeded: true,
      subActivities: {
        create: [
          {
            name: "Point North",
            displayOrder: 0,
            // Compass bearing (0–360°); scored as the offset from North, wrapping
            // around 360 (350° counts as 10° off). Target defaults to 0 (North).
            inputRule: "circular_deviation",
            sortDirection: "asc",
            inputFields: {
              create: [
                { label: "Bearing", unit: "degrees", defaultTargetValue: 0, displayOrder: 0 },
              ],
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
              ],
            },
          },
          {
            name: "Banana Split",
            displayOrder: 3,
            // Cut a banana in half and weigh each half — the closer the two weights,
            // the better. Score is the absolute difference between them.
            inputRule: "abs_difference",
            sortDirection: "asc",
            inputFields: {
              create: [
                { label: "Half A", unit: "grams", displayOrder: 0 },
                { label: "Half B", unit: "grams", displayOrder: 1 },
              ],
            },
          },
          {
            name: "Measurement Test",
            displayOrder: 4,
            // One measurement scored by how far it lands from a target; closest wins.
            // Target must be set per event before scores can be logged.
            inputRule: "abs_deviation_from_target",
            sortDirection: "asc",
            inputFields: {
              create: [{ label: "Measurement", unit: "cm", displayOrder: 0 }],
            },
          },
        ],
      },
    },
  });

  console.log("Seeded system activity templates.");
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
