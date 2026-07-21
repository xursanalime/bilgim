// Creates one published homework assignment (WRITING + READING modules)
// per demo group, attached to that group's TEXT_ONLY lesson. Driven
// entirely through the real HTTP API (login -> create -> publish) so it
// exercises the same authorization / module-validation / notification
// fan-out path a real teacher would hit.
const API = 'http://localhost:4000/api/v1';
const TEACHER_EMAIL = 'teacher@bilgim.uz';
const TEACHER_PASSWORD = 'Bilgim2026!';

const DUE_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const GROUPS = [
  {
    joinCode: 'TEQTMD', // A1 - Boshlang'ich
    title: "Uy vazifasi: O'zim haqimda",
    description: "A1 daraja uchun yozma va o'qish topshirig'i.",
    writing: {
      prompt:
        "O'zingiz haqingizda 5-8 ta gap yozing: ismingiz, yoshingiz, oilangiz, sevimli mashg'ulotingiz.",
      minWords: 30,
      maxWords: 150,
    },
    reading: {
      passage:
        "My name is Anna. I am twelve years old. I live in Tashkent with my family. Every morning I wake up at seven o'clock. I have breakfast and go to school. After school, I play with my friends.",
      questions: [
        {
          id: 'q1',
          prompt: 'How old is Anna?',
          kind: 'mcq',
          choices: ['Ten', 'Eleven', 'Twelve', 'Thirteen'],
          answer: 'Twelve',
        },
        {
          id: 'q2',
          prompt: 'Anna wakes up at eight o\'clock.',
          kind: 'true_false',
          answer: 'false',
        },
        {
          id: 'q3',
          prompt: 'What does Anna do after school?',
          kind: 'short',
          answer: 'She plays with her friends',
        },
      ],
    },
  },
  {
    joinCode: 'JFXNX8', // A2 - Elementar
    title: "Uy vazifasi: O'tgan dam olish kuni",
    description: "A2 daraja uchun yozma va o'qish topshirig'i.",
    writing: {
      prompt: "O'tgan dam olish kunizni qanday o'tkazganingiz haqida yozing.",
      minWords: 50,
      maxWords: 200,
    },
    reading: {
      passage:
        "Last weekend, Bobur went to the countryside with his family. They stayed at his grandmother's house. On Saturday, they picked apples in the garden. On Sunday, they cooked plov together and played games in the evening. Bobur really enjoyed the trip.",
      questions: [
        {
          id: 'q1',
          prompt: 'Where did Bobur go last weekend?',
          kind: 'mcq',
          choices: ['To the seaside', 'To the countryside', 'To the city center', 'To school'],
          answer: 'To the countryside',
        },
        {
          id: 'q2',
          prompt: 'They cooked plov on Saturday.',
          kind: 'true_false',
          answer: 'false',
        },
        {
          id: 'q3',
          prompt: 'What did they do in the garden?',
          kind: 'short',
          answer: 'They picked apples',
        },
      ],
    },
  },
  {
    joinCode: '6A7R6X', // B1 - O'rta
    title: 'Uy vazifasi: Ijtimoiy tarmoqlar',
    description: "B1 daraja uchun insho va o'qish topshirig'i.",
    writing: {
      prompt:
        "Ijtimoiy tarmoqlarning foyda va zararlari haqida insho yozing (kamida 2 ta foyda, 2 ta zarar keltiring).",
      minWords: 120,
      maxWords: 300,
    },
    reading: {
      passage:
        "Social media has changed the way people communicate. Millions of people use platforms like Instagram and Telegram every day to share news, photos, and ideas. While social media helps people stay connected with friends and family, experts warn that spending too much time online can affect sleep and mental health. Many schools now teach students about healthy, balanced internet use.",
      questions: [
        {
          id: 'q1',
          prompt: 'What can spending too much time on social media affect, according to the text?',
          kind: 'mcq',
          choices: ['Sleep and mental health', 'Handwriting', 'Eyesight only', 'Nothing'],
          answer: 'Sleep and mental health',
        },
        {
          id: 'q2',
          prompt: 'Schools never discuss internet use with students.',
          kind: 'true_false',
          answer: 'false',
        },
        {
          id: 'q3',
          prompt: 'In your own words, why do experts recommend balanced internet use?',
          kind: 'short',
          answer: 'Because too much screen time can harm sleep and mental health',
        },
      ],
    },
  },
  {
    joinCode: 'MCNQS2', // B2 - Yuqori o'rta
    title: 'Uy vazifasi: Masofaviy ish',
    description: "B2 daraja uchun insho va o'qish topshirig'i.",
    writing: {
      prompt:
        "Masofaviy ishlash (remote work) va ofisda ishlashni solishtirib, o'z fikringizni asoslab yozing.",
      minWords: 200,
      maxWords: 400,
    },
    reading: {
      passage:
        "Remote work has become increasingly common since 2020, with many companies allowing employees to work from home permanently. Supporters argue that remote work increases flexibility, reduces commuting time, and can improve work-life balance. Critics, however, point out that it can lead to isolation, blurred boundaries between work and personal life, and communication challenges within teams. Most organizations today are adopting a hybrid model, combining the benefits of both approaches.",
      questions: [
        {
          id: 'q1',
          prompt: 'Which model are most organizations adopting today, according to the passage?',
          kind: 'mcq',
          choices: ['Fully remote only', 'Fully in-office only', 'A hybrid model', 'No fixed model'],
          answer: 'A hybrid model',
        },
        {
          id: 'q2',
          prompt: 'Critics of remote work mention communication challenges.',
          kind: 'true_false',
          answer: 'true',
        },
        {
          id: 'q3',
          prompt: 'Summarize one benefit and one drawback of remote work mentioned in the text.',
          kind: 'short',
          answer: 'Benefit: flexibility/better work-life balance; drawback: isolation or blurred boundaries',
        },
      ],
    },
  },
];

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${opts.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEACHER_EMAIL, password: TEACHER_PASSWORD }),
  });
  const token = login.accessToken;
  const authHeaders = { Authorization: `Bearer ${token}` };

  const courses = await api('/catalog/courses', { headers: authHeaders });
  const course = courses.find((c) => c.title.includes('Demo'));
  if (!course) throw new Error('Demo course not found — run seed-demo-classroom.ts first');

  const groups = await api(`/catalog/courses/${course.id}/groups`, { headers: authHeaders });

  for (const def of GROUPS) {
    const group = groups.find((g) => g.joinCode === def.joinCode);
    if (!group) {
      console.warn(`Group with join code ${def.joinCode} not found — skipping`);
      continue;
    }

    const lessons = await api(`/catalog/groups/${group.id}/lessons`, { headers: authHeaders });
    const textLesson = lessons.find((l) => l.type === 'TEXT_ONLY');
    if (!textLesson) {
      console.warn(`No TEXT_ONLY lesson in group ${group.name} — skipping`);
      continue;
    }

    const created = await api(`/lessons/${textLesson.id}/assignments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: def.title,
        description: def.description,
        dueAt: DUE_AT,
        totalPoints: 100,
        modules: [
          {
            type: 'WRITING',
            order: 0,
            weight: 60,
            configJson: {
              prompt: def.writing.prompt,
              minWords: def.writing.minWords,
              maxWords: def.writing.maxWords,
            },
          },
          {
            type: 'READING',
            order: 1,
            weight: 40,
            configJson: {
              passage: def.reading.passage,
              questions: def.reading.questions,
            },
          },
        ],
      }),
    });

    await api(`/assignments/${created.id}/publish`, {
      method: 'POST',
      headers: authHeaders,
    });

    console.log(`Group "${group.name}": homework "${def.title}" published (assignment ${created.id})`);
  }

  console.log('\nHomework seeding complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
