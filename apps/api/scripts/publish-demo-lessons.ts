import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const groupId = 'c58b7e3f-68cc-4ba8-8ddc-578b0b027e59';

    // Get all lessons for the group
    const lessons = await prisma.lesson.findMany({ 
      where: { groupId } 
    });
    
    if (lessons.length === 0) {
      console.log('No lessons found in this group.');
      return;
    }

    let publishedCount = 0;
    for (const lesson of lessons) {
      if (lesson.status === 'READY') {
        console.log(`Lesson ${lesson.title} is already published.`);
        continue;
      }

      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { status: 'READY' }
      });
      console.log(`Published lesson: ${lesson.title}`);
      publishedCount++;
    }

    console.log(`Done! Successfully published ${publishedCount} lessons.`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
