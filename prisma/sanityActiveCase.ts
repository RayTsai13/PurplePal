import { PrismaClient, Prisma } from '../generated/prisma';

const prisma = new PrismaClient();

const userId = 'test-user-sanity';
const term = '2025-fall';

const isActiveCaseUniqueViolation = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return true;
  }

  return error instanceof Error && error.message.includes('ux_active_case_per_term');
};

const run = async (): Promise<number> => {
  await prisma.verificationCase.deleteMany({ where: { userId, term } });

  await prisma.verificationCase.create({
    data: { userId, term, state: 'joined' },
  });

  try {
    await prisma.verificationCase.create({
      data: { userId, term, state: 'hall_chosen' },
    });

    console.error('FAIL: index not enforced (second insert succeeded)');
    return 1;
  } catch (error) {
    if (isActiveCaseUniqueViolation(error)) {
      console.log('PASS: partial unique index enforced');
      return 0;
    }

    console.error('FAIL: unexpected error verifying unique index');
    console.error(error);
    return 1;
  }
};

run()
  .then(async (exitCode) => {
    await prisma.$disconnect();
    process.exit(exitCode);
  })
  .catch(async (error) => {
    console.error('FAIL: sanity test encountered an unexpected error');
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
