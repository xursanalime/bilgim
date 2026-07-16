import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import * as https from 'https';

const prisma = new PrismaClient();

const s3 = new S3Client({
  region: 'auto',
  endpoint: 'http://127.0.0.1:9010',
  credentials: {
    accessKeyId: 'bilgim',
    secretAccessKey: 'bilgim_dev',
  },
  forcePathStyle: true,
});

async function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const data: any[] = [];
      res.on('data', (chunk) => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data)));
    }).on('error', reject);
  });
}

async function uploadToMinio(key: string, buffer: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: 'bilgim-media',
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

async function main() {
  try {
    const teacherEmail = 'teacher_1782207804008@gmail.com';
    const teacher = await prisma.user.findUnique({ where: { email: teacherEmail } });
    if (!teacher) throw new Error('Teacher not found');

    const groupId = 'c58b7e3f-68cc-4ba8-8ddc-578b0b027e59';

    const lessons = await prisma.lesson.findMany({ 
      where: { groupId } 
    });
    
    if (lessons.length === 0) {
      console.log('No lessons found in this group.');
      return;
    }

    console.log('Downloading demo files...');
    const mp4Buffer = await downloadFile('https://www.w3schools.com/html/mov_bbb.mp4');
    const pdfBuffer = await downloadFile('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf');

    for (const lesson of lessons) {
      if (lesson.type === 'RECORDED' || lesson.type === 'HYBRID') {
        // Skip if already attached
        const existing = await prisma.attachment.findFirst({ where: { lessonId: lesson.id, kind: 'VIDEO' }});
        if (existing) {
          console.log(`Lesson ${lesson.title} already has a VIDEO attachment, skipping.`);
          continue;
        }

        console.log(`Uploading video for lesson: ${lesson.title}...`);
        const assetId = randomUUID();
        const key = `uploads/${teacher.id}/${assetId}/video.mp4`;
        await uploadToMinio(key, mp4Buffer, 'video/mp4');

        await prisma.mediaAsset.create({
          data: {
            id: assetId,
            ownerUserId: teacher.id,
            kind: 'VIDEO',
            status: 'READY',
            bytes: mp4Buffer.length,
            contentType: 'video/mp4',
            originalKey: key,
            metadata: { fileName: 'demo_video.mp4' },
          }
        });

        await prisma.attachment.create({
          data: {
            lessonId: lesson.id,
            assetId: assetId,
            kind: 'VIDEO',
            role: 'main'
          }
        });
      } else if (lesson.type === 'TEXT_ONLY') {
        const existing = await prisma.attachment.findFirst({ where: { lessonId: lesson.id, kind: 'PDF' }});
        if (existing) {
          console.log(`Lesson ${lesson.title} already has a PDF attachment, skipping.`);
          continue;
        }

        console.log(`Uploading PDF for lesson: ${lesson.title}...`);
        const assetId = randomUUID();
        const key = `uploads/${teacher.id}/${assetId}/document.pdf`;
        await uploadToMinio(key, pdfBuffer, 'application/pdf');

        await prisma.mediaAsset.create({
          data: {
            id: assetId,
            ownerUserId: teacher.id,
            kind: 'PDF',
            status: 'READY',
            bytes: pdfBuffer.length,
            contentType: 'application/pdf',
            originalKey: key,
            metadata: { fileName: 'demo_pdf.pdf' },
          }
        });

        await prisma.attachment.create({
          data: {
            lessonId: lesson.id,
            assetId: assetId,
            kind: 'PDF',
            role: 'main'
          }
        });
      }
    }

    console.log('Done! Demo assets uploaded and attached to all applicable lessons.');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
