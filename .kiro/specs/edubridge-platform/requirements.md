# Requirements Document

## Introduction

EduBridge — O'zbekiston uchun mo'ljallangan ikki tomonlama (teacher ↔ student) onlayn ta'lim platformasi. O'qituvchilar kurs va guruhlar yaratadi, dars materiallarini (video, jonli efir, fayl, audio, uy vazifasi) yuklaydi va to'lovli obuna asosida ishlaydi. Talabalar invite link yoki public discovery orqali platformaga kirib, Payme to'lovini amalga oshirib, o'qituvchi tasdiqlashidan keyin darslarni ko'radi. Platforma NestJS modular monolith backend, Next.js 14 frontend, PostgreSQL, Redis, BullMQ, Cloudflare R2, Claude API, Payme, mediasoup va Docker asosida quriladi.

## Glossary

- **Platform**: EduBridge ta'lim platformasi tizimi
- **Auth_Module**: Foydalanuvchi ro'yxatdan o'tish, login, JWT token boshqaruvi va parol tiklash moduli
- **Billing_Module**: Trial, obuna, Payme integratsiyasi va to'lov boshqaruvi moduli
- **Catalog_Module**: Kurslar, guruhlar, darslar, jadval va media boshqaruvi moduli
- **Enrollment_Module**: Invite link, qo'shilish so'rovi va tasdiqlash moduli
- **Live_Module**: Jonli efir lifecycle, signaling va yozib olish moduli
- **Homework_Module**: Uy vazifasi, topshiriq va baholash moduli
- **AI_Gateway**: Claude API bilan integratsiya, tutor rejimi va AI-text aniqlash moduli
- **Notifications_Module**: Ko'p kanalli xabarnoma fan-out moduli
- **Discovery_Module**: Ochiq qidiruv va o'qituvchi profili moduli
- **Chat_Module**: Guruh, jonli efir va DM chat moduli
- **Admin_Module**: Platforma boshqaruvi, specialty va modul katalogi moduli
- **Media_Module**: R2 upload, transcoding va fayl metadata moduli
- **Outbox_Dispatcher**: Transactional outbox pattern orqali asinxron eventlarni yetkazish komponenti
- **SFU**: mediasoup Selective Forwarding Unit — jonli video/audio uzatish serveri
- **Teacher**: O'qituvchi roli — kurs yaratadi, dars beradi, talabalarni boshqaradi
- **Student**: Talaba roli — kurslarga yoziladi, darslarni ko'radi, uy vazifalarini bajaradi
- **Admin**: Platforma administratori — specialty, modullar va foydalanuvchilarni boshqaradi
- **Enrollment**: Talabaning guruhga muvaffaqiyatli qo'shilishi (to'lov + tasdiqlash)
- **Subscription**: O'qituvchining platforma obunasi (TRIAL → ACTIVE → PAST_DUE → CANCELED)
- **GroupModule**: Guruh darajasidagi uy vazifa moduli toggle holati
- **SpecialtyModule**: Specialty darajasidagi uy vazifa modul katalogi (admin boshqaradi, ≤10 ta)
- **WAF**: Web Application Firewall — HTTP so'rovlarni tahlil qilib, zararli trafikni bloklash tizimi
- **SIEM**: Security Information and Event Management — xavfsizlik hodisalarini yig'ish, korrelyatsiya qilish va tahlil qilish tizimi
- **MFA**: Multi-Factor Authentication — ko'p bosqichli autentifikatsiya (parol + ikkinchi faktor)
- **TOTP**: Time-based One-Time Password — vaqtga asoslangan bir martalik parol (Google Authenticator, Authy)
- **WebAuthn**: Web Authentication API — brauzer orqali hardware kalitlar bilan autentifikatsiya standarti
- **FIDO2**: Fast Identity Online 2 — parolsiz autentifikatsiya protokoli (WebAuthn + CTAP)
- **HMAC**: Hash-based Message Authentication Code — xabar yaxlitligini va autentligini tekshirish algoritmi
- **KMS**: Key Management Service — shifrlash kalitlarini xavfsiz saqlash va boshqarish xizmati (AWS KMS, HashiCorp Vault)
- **SBOM**: Software Bill of Materials — dasturiy ta'minot tarkibidagi barcha komponentlar va bog'liqliklar ro'yxati
- **SAST**: Static Application Security Testing — manba kodini statik tahlil qilib zaifliklarni aniqlash
- **DAST**: Dynamic Application Security Testing — ishlab turgan ilovani dinamik tahlil qilib zaifliklarni aniqlash
- **SCA**: Software Composition Analysis — ochiq kodli kutubxonalardagi zaifliklarni aniqlash
- **SOC2**: Service Organization Control Type 2 — xavfsizlik, mavjudlik va maxfiylik bo'yicha audit standarti
- **Zero_Trust**: Hech kimga ishonmaslik prinsipi — har bir so'rov va foydalanuvchi har doim tekshiriladi, tarmoq ichida ham

## Requirements

### Requirement 1: Foydalanuvchi autentifikatsiyasi va sessiya boshqaruvi

**User Story:** O'qituvchi yoki talaba sifatida men platformaga xavfsiz ro'yxatdan o'tmoqchiman va login qilmoqchiman, shunda mening ma'lumotlarim himoyalangan bo'ladi va faqat men o'z akkauntimga kira olaman.

#### Acceptance Criteria

1. WHEN foydalanuvchi email, parol, fullName va role bilan ro'yxatdan o'tsa, THE Auth_Module SHALL yangi User yaratib, status=PENDING_VERIFY qilib saqlashi va email verification token yuborishi kerak
2. WHEN foydalanuvchi email verification tokenini taqdim etsa, THE Auth_Module SHALL User statusini ACTIVE ga o'zgartirishi kerak
3. WHEN foydalanuvchi to'g'ri email va parol bilan login qilsa, THE Auth_Module SHALL accessToken (JWT, 15 daqiqa TTL) va refreshToken (opaque, 30 kun TTL) qaytarishi kerak
4. WHEN foydalanuvchi refreshToken bilan yangilash so'rasa, THE Auth_Module SHALL eski refreshToken ni bekor qilib yangi token juftligini qaytarishi kerak
5. WHEN foydalanuvchi noto'g'ri parol bilan login qilsa, THE Auth_Module SHALL 401 UNAUTHENTICATED xatosini qaytarishi kerak
6. IF refreshToken o'g'irlangan deb aniqlansa (family detection), THEN THE Auth_Module SHALL o'sha foydalanuvchining barcha sessiyalarini bekor qilishi kerak
7. WHEN foydalanuvchi parol tiklash so'rasa, THE Auth_Module SHALL email orqali tiklash tokenini yuborishi kerak
8. THE Auth_Module SHALL parollarni Argon2id (m=19MiB, t=2, p=1) bilan hash qilishi kerak
9. THE Auth_Module SHALL refreshToken ni DB da hash qilib saqlashi kerak (plaintext emas)

### Requirement 2: O'qituvchi onboarding va specialty tayinlash

**User Story:** O'qituvchi sifatida men ro'yxatdan o'tganimdan keyin onboarding quizni to'ldirmoqchiman, shunda platforma menga mos specialty ni aniqlaydi va maxsus dashboard ko'rsatadi.

#### Acceptance Criteria

1. WHEN yangi o'qituvchi email verifikatsiyasini yakunlasa, THE Billing_Module SHALL avtomatik ravishda 14 kunlik TRIAL obuna yaratishi kerak
2. WHEN o'qituvchi onboarding quiz javoblarini yuborsa, THE Auth_Module SHALL javoblar asosida specialtyId ni tayinlashi kerak (deterministic rule-based, agar aniq bo'lmasa Claude fallback)
3. WHEN specialty tayinlangandan keyin, THE Platform SHALL o'qituvchini specialty-specific dashboard ga yo'naltirishi kerak
4. IF quiz javoblari 55% dan past confidence bersa, THEN THE AI_Gateway SHALL Claude orqali specialty ni aniqlashi kerak
5. THE Platform SHALL har bir o'qituvchiga faqat bitta specialty tayinlashi kerak

### Requirement 3: O'qituvchi obuna state machine

**User Story:** O'qituvchi sifatida men trial davridan keyin to'lov qilib obunani davom ettirmoqchiman, shunda dars yaratish va boshqarish imkoniyatlarim saqlanib qoladi.

#### Acceptance Criteria

1. THE Billing_Module SHALL obuna holatlarini quyidagi tartibda boshqarishi kerak: TRIAL → ACTIVE → PAST_DUE → CANCELED/EXPIRED
2. WHILE obuna TRIAL holatida bo'lsa, THE Billing_Module SHALL avtomatik ravishda hech qanday Invoice yaratmasligi kerak. Lekin o'qituvchi explicit ravishda erta upgrade qilmoqchi bo'lib `POST /billing/checkout` (kind=TEACHER_SUBSCRIPTION) chaqirsa, Billing_Module PENDING TEACHER_SUBSCRIPTION Invoice yaratishi mumkin — bu Invoice faqat PerformTransaction muvaffaqiyatli bo'lganda obunani TRIAL → ACTIVE ga o'tkazish uchun ishlatiladi (Req 4.6 ga mos)
3. WHEN trial muddati (14 kun) tugasa, THE Billing_Module SHALL obunani EXPIRED ga o'tkazishi kerak
4. WHEN o'qituvchi to'lovni muvaffaqiyatli amalga oshirsa, THE Billing_Module SHALL obunani TRIAL dan ACTIVE ga o'tkazishi kerak
5. WHEN aktiv obuna davri tugasa va to'lov olinmasa, THE Billing_Module SHALL obunani PAST_DUE ga o'tkazishi kerak
6. WHEN PAST_DUE holatida 7 kun o'tsa va to'lov bo'lmasa, THE Billing_Module SHALL obunani EXPIRED ga o'tkazishi kerak
7. THE Billing_Module SHALL har bir o'qituvchi uchun bir vaqtda faqat bitta non-terminal obuna (TRIAL, ACTIVE, PAST_DUE) saqlashi kerak (partial unique index)
8. WHILE obuna EXPIRED yoki CANCELED holatida bo'lsa, THE Catalog_Module SHALL o'qituvchiga yangi dars publish qilishni taqiqlashi kerak

### Requirement 4: Payme to'lov integratsiyasi va atomicity

**User Story:** Talaba sifatida men Payme orqali kurs uchun to'lov qilmoqchiman, shunda to'lov muvaffaqiyatli bo'lganda avtomatik ravishda enrollment so'rovi yaratiladi.

#### Acceptance Criteria

1. WHEN talaba checkout boshlasa, THE Billing_Module SHALL PaymeTransaction (state=PENDING) va Invoice yaratib, Payme payUrl qaytarishi kerak
2. WHEN Payme PerformTransaction webhook kelsa, THE Billing_Module SHALL bitta DB tranzaktsiya ichida PaymeTransaction.state=PAID, Invoice.status=PAID, EnrollmentRequest va OutboxEvent yaratishi kerak
3. IF Payme webhook Basic Auth noto'g'ri bo'lsa, THEN THE Billing_Module SHALL JSON-RPC -32504 xatosini qaytarishi va security audit logga yozishi kerak
4. THE Billing_Module SHALL Payme webhook ni idempotent qilishi kerak — bir xil paymeId bilan ikki marta chaqirilsa, ikkinchi safar oldingi natija qaytarilishi kerak
5. WHEN to'lov muvaffaqiyatli bo'lsa va invoice.kind=STUDENT_COURSE bo'lsa, THE Billing_Module SHALL aynan bitta EnrollmentRequest (status=PENDING_APPROVAL) yaratishi kerak
6. WHEN to'lov muvaffaqiyatli bo'lsa va invoice.kind=TEACHER_SUBSCRIPTION bo'lsa, THE Billing_Module SHALL obunani ACTIVE ga o'tkazishi kerak
7. IF Payme -31001 (invalid amount) yoki -31050 (account not found) qaytarsa, THEN THE Billing_Module SHALL PaymeTransaction.state=CANCELED qilib, payment.failed outbox event yaratishi kerak
8. THE Billing_Module SHALL har bir PaymeTransaction uchun unique idempotencyKey saqlashi kerak

### Requirement 5: Talaba enrollment jarayoni

**User Story:** Talaba sifatida men invite link yoki public discovery orqali guruhga qo'shilmoqchiman, shunda to'lov va o'qituvchi tasdiqlashidan keyin darslarni ko'ra olaman.

#### Acceptance Criteria

1. WHEN o'qituvchi invite link yaratsa, THE Enrollment_Module SHALL unique token, expiresAt va usesLimit bilan InviteLink yaratishi kerak
2. WHEN talaba invite token bilan so'rov yuborsa, THE Enrollment_Module SHALL guruh ma'lumotlari va narxini qaytarishi kerak
3. WHEN to'lov muvaffaqiyatli bo'lgandan keyin, THE Enrollment_Module SHALL EnrollmentRequest (status=PENDING_APPROVAL) yaratishi kerak
4. WHEN o'qituvchi enrollment so'rovini tasdiqlasa, THE Enrollment_Module SHALL Enrollment (status=APPROVED) yaratishi va talabaga xabarnoma yuborishi kerak
5. WHEN o'qituvchi enrollment so'rovini rad etsa, THE Enrollment_Module SHALL EnrollmentRequest statusini REJECTED ga o'zgartirishi kerak
6. THE Enrollment_Module SHALL har bir (groupId, studentId) juftligi uchun faqat bitta Enrollment saqlashi kerak
7. IF invite link muddati o'tgan yoki uses limiti tugagan bo'lsa, THEN THE Enrollment_Module SHALL 404 qaytarishi kerak

### Requirement 6: Enrollment-gated dars kontentiga kirish

**User Story:** Platforma sifatida men faqat to'lov qilgan va tasdiqlangan talabalarga dars kontentini ko'rsatmoqchiman, shunda kontentga ruxsatsiz kirish oldini olinadi.

#### Acceptance Criteria

1. WHEN talaba darsni ko'rmoqchi bo'lsa, THE Catalog_Module SHALL Enrollment (groupId=lesson.groupId, studentId=user.id, status=APPROVED) mavjudligini tekshirishi kerak
2. IF talabaning enrollment statusi APPROVED bo'lmasa, THEN THE Catalog_Module SHALL 403 LESSON_ACCESS_DENIED qaytarishi kerak
3. WHEN o'qituvchi o'z darsini ko'rmoqchi bo'lsa, THE Catalog_Module SHALL faqat lesson.group.course.teacherId = user.id bo'lsa ruxsat berishi kerak
4. WHEN admin darsni ko'rmoqchi bo'lsa, THE Catalog_Module SHALL read-only audit uchun ruxsat berishi kerak
5. IF foydalanuvchi TEACHER bo'lib lekin dars boshqa o'qituvchiniki bo'lsa, THEN THE Catalog_Module SHALL 403 NOT_OWNING_TEACHER qaytarishi kerak
6. THE Catalog_Module SHALL hech qachon payment yoki approval holatini chetlab o'tmasligi kerak

### Requirement 7: Kurs, guruh va dars CRUD

**User Story:** O'qituvchi sifatida men kurslar, guruhlar va darslar yaratib boshqarmoqchiman, shunda talabalarimga tizimli ta'lim bera olaman.

#### Acceptance Criteria

1. WHEN o'qituvchi yangi kurs yaratsa, THE Catalog_Module SHALL Course (isPublished=false, isDiscoverable=true) yaratishi kerak
2. WHEN o'qituvchi kurs ichida guruh yaratsa, THE Catalog_Module SHALL Group yaratishi va o'qituvchining specialty katalogidagi barcha SpecialtyModule lar uchun GroupModule yozuvlarini seed qilishi kerak
3. WHEN guruh yaratilganda GroupModule seed qilinsa, THE Catalog_Module SHALL har bir modul uchun isEnabled=SpecialtyModule.defaultEnabled qiymatini o'rnatishi kerak
4. WHEN o'qituvchi dars yaratsa, THE Catalog_Module SHALL Lesson (status=DRAFT) yaratishi kerak
5. WHEN o'qituvchi darsni publish qilsa, THE Catalog_Module SHALL Lesson statusini READY ga o'zgartirishi va lesson.published eventini emit qilishi kerak
6. WHEN lesson.published eventi emit bo'lsa, THE Notifications_Module SHALL guruhga ro'yxatdan o'tgan barcha talabalarga xabarnoma yuborishi kerak
7. THE Catalog_Module SHALL barcha catalog so'rovlarini JWT dan olingan teacherId bilan parametrize qilishi kerak (cross-teacher access imkonsiz)

### Requirement 8: Media upload va video transcoding

**User Story:** O'qituvchi sifatida men video va fayllarni yuklashni xohlayman, shunda talabalar HLS formatida sifatli video ko'ra oladi.

#### Acceptance Criteria

1. WHEN o'qituvchi fayl yuklashni boshlasa, THE Media_Module SHALL R2 multipart upload initiate qilib, uploadId va presigned partUrls qaytarishi kerak
2. WHEN barcha partlar yuklangandan keyin complete so'rovi kelsa, THE Media_Module SHALL R2 da multipart ni yakunlashi va MediaAsset statusini UPLOADED ga o'zgartirishi kerak
3. WHEN video UPLOADED holatiga o'tsa, THE Media_Module SHALL BullMQ orqali transcoding job ni queue ga qo'shishi kerak
4. WHEN transcoding worker video ni qayta ishlasa, THE Media_Module SHALL ffmpeg orqali HLS formatida (240p, 480p, 720p, 1080p) variantlar yaratishi kerak
5. WHEN transcoding muvaffaqiyatli tugasa, THE Media_Module SHALL MediaAsset statusini READY ga o'zgartirishi va hlsManifestKey ni saqlashi kerak
6. IF upload 24 soat ichida complete bo'lmasa, THEN THE Media_Module SHALL cron orqali AbortMultipartUpload chaqirib, UPLOADING holatidagi MediaAsset ni tozalashi kerak
7. THE Media_Module SHALL faqat ruxsat etilgan fayl turlarini qabul qilishi kerak (PDF, DOCX, XLSX, images, audio, video)

### Requirement 9: Jonli efir (Live streaming)

**User Story:** O'qituvchi sifatida men jonli efir o'tkazmoqchiman, shunda talabalar real-time darsni kuzatib, chat orqali savol bera oladi.

#### Acceptance Criteria

1. WHEN o'qituvchi jonli efirni boshlasa, THE Live_Module SHALL LiveSession (status=STARTING) yaratishi, mediasoup router allocate qilishi va statusni LIVE ga o'zgartirishi kerak
2. WHEN jonli efir boshlansa, THE Live_Module SHALL recorder process ni spawn qilishi kerak (ffmpeg pipe)
3. WHEN jonli efir boshlansa, THE Notifications_Module SHALL guruhga ro'yxatdan o'tgan barcha talabalarga live.started xabarnomasi yuborishi kerak
4. WHEN talaba jonli efirga ulanmoqchi bo'lsa, THE Live_Module SHALL enrollment tekshiruvidan o'tkazishi kerak (faqat APPROVED talabalar)
5. WHEN o'qituvchi jonli efirni tugatsa, THE Live_Module SHALL mediasoup router ni yopishi va recording ni finalize qilishi kerak
6. WHEN recording muvaffaqiyatli finalize bo'lsa, THE Live_Module SHALL Recording (status=READY) va Attachment yaratishi, LiveSession statusini ENDED ga o'zgartirishi kerak
7. IF recording finalize muvaffaqiyatsiz bo'lsa, THEN THE Live_Module SHALL LiveSession statusini RECORDING_FAILED ga o'zgartirishi va Recording (status=FAILED) yaratishi kerak
8. THE Live_Module SHALL hech qachon LiveSession ni LIVE holatida qoldirib ketmasligi kerak — har doim ENDED yoki RECORDING_FAILED ga o'tishi shart
9. WHILE jonli efir davom etayotganda, THE Chat_Module SHALL real-time chat xabarlarini Socket.io orqali uzatishi kerak

### Requirement 10: Jadval boshqaruvi va xabarnoma fan-out

**User Story:** O'qituvchi sifatida men guruh jadvalini RRULE formatida belgilab, o'zgartirmoqchiman, shunda talabalar har bir o'zgarish haqida xabardor bo'ladi.

#### Acceptance Criteria

1. WHEN o'qituvchi guruh jadvalini o'rnatsa yoki o'zgartirsa, THE Catalog_Module SHALL Schedule.version ni 1 ga oshirishi va schedule.changed outbox eventini yaratishi kerak
2. WHEN schedule.changed eventi qayta ishlanayotganda, THE Notifications_Module SHALL guruhga APPROVED enrollment bilan ro'yxatdan o'tgan har bir talabaga aynan bitta Notification yaratishi kerak
3. THE Notifications_Module SHALL idempotencyKey = "schedule.changed:{groupId}:v{version}:{studentId}" formatidan foydalanishi kerak
4. IF bir xil outbox event ikki marta qayta ishlansa (worker retry), THEN THE Notifications_Module SHALL takroriy Notification yaratmasligi kerak (ON CONFLICT DO NOTHING)
5. WHEN xabarnoma yaratilgandan keyin, THE Notifications_Module SHALL talabaning NotificationPreference sozlamalariga qarab IN_APP, EMAIL, TELEGRAM va PUSH kanallariga delivery job qo'shishi kerak
6. THE Notifications_Module SHALL har bir event uchun har bir talabaga aynan bitta xabarnoma yuborishni kafolatlashi kerak (idempotency)
7. WHEN jonli efir 15 daqiqa qolganda, THE Notifications_Module SHALL reminder xabarnomasi yuborishi kerak

### Requirement 11: Uy vazifa modul katalogi va per-Group toggle

**User Story:** O'qituvchi sifatida men guruhim uchun qaysi uy vazifa modullarini yoqish/o'chirishni boshqarmoqchiman, shunda har bir guruhga mos modullar tanlanadi.

#### Acceptance Criteria

1. THE Admin_Module SHALL har bir Specialty uchun eng ko'pi bilan 10 ta active SpecialtyModule saqlashi kerak (DB constraint trigger + service-layer guard)
2. WHEN guruh yaratilganda, THE Catalog_Module SHALL o'qituvchining specialty katalogidagi har bir SpecialtyModule uchun GroupModule yozuvi yaratishi kerak (isEnabled=SpecialtyModule.defaultEnabled)
3. WHEN o'qituvchi guruh sozlamalarida modulni yoqsa yoki o'chirsa, THE Catalog_Module SHALL GroupModule.isEnabled ni yangilashi va group.module.toggled eventini emit qilishi kerak
4. WHEN modul o'chirilganda, THE Catalog_Module SHALL mavjud Assignment va Submission larni buzmasligi kerak (non-destructive toggle)
5. WHEN o'qituvchi AssignmentBuilder da modul tanlasa, THE Homework_Module SHALL faqat GroupModule.isEnabled=true bo'lgan modullarni ko'rsatishi kerak
6. IF o'qituvchi specialty katalogida mavjud bo'lmagan moduleType ni toggle qilmoqchi bo'lsa, THEN THE Catalog_Module SHALL MODULE_NOT_IN_SPECIALTY_CATALOG xatosini qaytarishi kerak
7. THE Admin_Module SHALL 11-chi active modulni qo'shishga urinishda specialty_module_cap_exceeded xatosini qaytarishi kerak
8. WHEN assignment yaratilayotganda, THE Homework_Module SHALL har bir tanlangan modul uchun GroupModule.isEnabled=true ekanligini server-side tekshirishi kerak (UI bypass himoyasi)

### Requirement 12: Uy vazifa topshirish va baholash lifecycle

**User Story:** Talaba sifatida men uy vazifalarini yozib topshirmoqchiman va o'qituvchi AI yordamida baholamoqchi, shunda tezkor va sifatli fikr-mulohaza olaman.

#### Acceptance Criteria

1. WHILE talaba uy vazifasini yozayotganda, THE Homework_Module SHALL har 10 soniyada autosave qilishi kerak (Submission status=DRAFT)
2. WHEN talaba uy vazifasini topshirsa, THE Homework_Module SHALL Submission statusini SUBMITTED ga o'zgartirishi va submittedAt ni belgilashi kerak
3. WHEN submission SUBMITTED holatiga o'tsa, THE Homework_Module SHALL BullMQ orqali AI grading precheck job ni queue ga qo'shishi kerak
4. WHEN AI precheck tugasa, THE Homework_Module SHALL Submission statusini IN_REVIEW ga o'zgartirishi va Feedback (authorType=AI_DRAFT) yaratishi kerak
5. WHEN o'qituvchi yakuniy baho bersa, THE Homework_Module SHALL Submission statusini GRADED ga o'zgartirishi, score va finalFeedback ni saqlashi kerak
6. WHEN submission baholangandan keyin, THE Notifications_Module SHALL talabaga submission.graded xabarnomasi yuborishi kerak
7. THE Homework_Module SHALL submission lifecycle ni quyidagi tartibda boshqarishi kerak: DRAFT → SUBMITTED → IN_REVIEW → GRADED → RETURNED
8. THE Homework_Module SHALL har bir (assignmentId, studentId) juftligi uchun faqat bitta Submission saqlashi kerak

### Requirement 13: AI tutor rejimi va policy enforcement

**User Story:** Talaba sifatida men AI dan tushuntirish, tarjima va misollar so'ramoqchiman, shunda uy vazifamni mustaqil bajarishda yordam olaman, lekin AI menga tayyor javob bermasligi kerak.

#### Acceptance Criteria

1. WHEN talaba AI tutor dan EXPLAIN, TRANSLATE yoki EXAMPLE intent bilan so'rasa, THE AI_Gateway SHALL Claude API ga so'rov yuborishi kerak
2. THE AI_Gateway SHALL system prompt da "NEVER write a complete sentence/paragraph that the student could submit verbatim" qoidasini majburiy qilishi kerak
3. WHEN AI javobi talabaning aktiv submission matni bilan 0.7 dan yuqori cosine similarity ko'rsatsa, THE AI_Gateway SHALL javobni hint sifatida qayta yozishi kerak
4. THE AI_Gateway SHALL har bir AI chaqiruvini AiCall jadvaliga audit qilishi kerak (userId, intent, cost, latency, tokens)
5. IF talaba rate limitdan oshsa (60 calls / 10 daqiqa), THEN THE AI_Gateway SHALL 429 TOO_MANY_REQUESTS qaytarishi kerak
6. THE AI_Gateway SHALL hech qachon talaba uchun yakuniy javob yozmasligi kerak — faqat qoidalar, boshqa mavzudagi misollar va qisman hintlar berishi mumkin
7. WHEN AI grading precheck bajarilsa, THE AI_Gateway SHALL AI-text detection (perplexity heuristic + Claude classifier) orqali aiLikelihood (0..1) hisoblashi kerak
8. IF aiLikelihood >= 0.75 bo'lsa, THEN THE Homework_Module SHALL Submission.aiFlagged=true belgilashi kerak

### Requirement 14: Public discovery va qidiruv

**User Story:** Visitor sifatida men platformada o'qituvchilarni fan yoki ism bo'yicha qidirmoqchiman, shunda menga mos o'qituvchini topib, uning kurslariga yozila olaman.

#### Acceptance Criteria

1. WHEN visitor qidiruv so'rovini yuborsa, THE Discovery_Module SHALL PostgreSQL full-text search + pg_trgm trigram orqali TeacherProfile, Course va Group lardan natija qaytarishi kerak
2. THE Discovery_Module SHALL faqat isDiscoverable=true va isPublished=true bo'lgan natijalarni qaytarishi kerak
3. WHEN visitor o'qituvchining public profilini ko'rsa, THE Discovery_Module SHALL faqat isDiscoverable=true bo'lgan kurslar va guruhlarni ko'rsatishi kerak
4. IF TeacherProfile.publicSlug NULL bo'lsa, THEN THE Discovery_Module SHALL o'sha o'qituvchini qidiruv natijalarida ko'rsatmasligi kerak
5. THE Discovery_Module SHALL barcha /discovery/* endpointlarini read replica dan o'qishi kerak
6. WHEN visitor o'qituvchi profilidan "Enroll" boshlasa, THE Platform SHALL mavjud Payme + enrollment-request flow ga yo'naltirishi kerak (alohida path emas)
7. THE Discovery_Module SHALL qidiruv natijalarini Redis da 30 soniya cache qilishi kerak

### Requirement 15: Direct Messaging (DM)

**User Story:** Talaba sifatida men o'qituvchiga to'g'ridan-to'g'ri xabar yozmoqchiman, shunda kurs haqida savol bera olaman.

#### Acceptance Criteria

1. WHEN birinchi DM xabari yuborilsa, THE Chat_Module SHALL ChatRoom (scope=DM, scopeRef=sorted pair "min(userIdA,userIdB):max(userIdA,userIdB)") lazy yaratishi kerak
2. THE Chat_Module SHALL har bir foydalanuvchi juftligi uchun faqat bitta DM ChatRoom yaratishi kerak (UNIQUE constraint on scope+scopeRef)
3. WHILE DM reciprocated bo'lmagan holatda (peer javob yozmagan), THE Chat_Module SHALL yuboruvchini 1 xabar/daqiqa rate limit bilan cheklashi kerak
4. WHEN peer javob yozsa (reciprocated), THE Chat_Module SHALL rate limitni olib tashlab, faqat global limit (~30 msg/min per user) qo'llashi kerak
5. IF rate limit buzilsa, THEN THE Chat_Module SHALL 429 RATE_LIMITED qaytarishi kerak
6. WHEN DM xabari yuborilsa, THE Notifications_Module SHALL qabul qiluvchiga xabarnoma yuborishi kerak
7. THE Chat_Module SHALL DM uchun faqat STUDENT va TEACHER rollariga ruxsat berishi kerak (ADMIN DM yoza olmaydi)

### Requirement 16: Xabarnomalar va multi-channel delivery

**User Story:** Talaba sifatida men dars, jadval o'zgarishi va baho haqida turli kanallar (in-app, email, Telegram, push) orqali xabardor bo'lmoqchiman, shunda muhim yangiliklar e'tiborimdan chetda qolmaydi.

#### Acceptance Criteria

1. WHEN xabarnoma yaratilsa, THE Notifications_Module SHALL talabaning NotificationPreference sozlamalariga qarab tegishli kanallarga delivery job qo'shishi kerak
2. THE Notifications_Module SHALL quyidagi xabarnoma turlarini qo'llab-quvvatlashi kerak: ENROLLMENT_APPROVED, LESSON_PUBLISHED, SCHEDULE_CHANGED, LIVE_STARTED, LIVE_REMINDER, HOMEWORK_GRADED, PAYMENT_SUCCEEDED, TRIAL_ENDING
3. WHEN talaba xabarnoma sozlamalarini o'zgartirsa, THE Notifications_Module SHALL per-kind per-channel enabled/disabled holatini saqlashi kerak
4. THE Notifications_Module SHALL har bir Notification uchun unique idempotencyKey saqlashi kerak (takroriy xabarnoma oldini olish)
5. WHEN delivery muvaffaqiyatsiz bo'lsa, THE Notifications_Module SHALL retry qilishi kerak (exponential backoff)
6. THE Notifications_Module SHALL har bir NotificationDelivery uchun providerRef (SES message id, telegram update id) saqlashi kerak

### Requirement 17: RBAC va authorization

**User Story:** Platforma sifatida men har bir foydalanuvchiga faqat o'z roliga mos ruxsatlarni bermoqchiman, shunda xavfsizlik ta'minlanadi.

#### Acceptance Criteria

1. THE Platform SHALL uchta asosiy rolni qo'llab-quvvatlashi kerak: STUDENT, TEACHER, ADMIN
2. WHEN controller route handler chaqirilsa, THE Platform SHALL JwtAuthGuard + RolesGuard yoki domain-specific guard (LessonAccessGuard) mavjudligini tekshirishi kerak
3. IF route handler @Public() decorator bilan belgilanmagan va guard yo'q bo'lsa, THEN THE Platform SHALL 401 UNAUTHENTICATED qaytarishi kerak
4. THE Platform SHALL har bir controller route uchun yoki @Public() yoki auth guard mavjudligini kafolatlashi kerak (ESLint rule + runtime check)
5. WHEN TEACHER o'z resurslari bilan ishlasa, THE Platform SHALL faqat o'ziga tegishli kurs/guruh/darslarni ko'rsatishi kerak (teacherId filter)
6. WHEN STUDENT boshqa talabaning submission ini ko'rmoqchi bo'lsa, THE Platform SHALL 403 FORBIDDEN qaytarishi kerak

### Requirement 18: Outbox pattern va event-driven arxitektura

**User Story:** Platforma sifatida men barcha asinxron side-effectlarni (email, telegram, notification fan-out) ishonchli va atomik tarzda yetkazmoqchiman, shunda hech qanday event yo'qolmaydi.

#### Acceptance Criteria

1. WHEN mutating operatsiya side-effect talab qilsa, THE Outbox_Dispatcher SHALL bitta DB tranzaktsiya ichida OutboxEvent yaratishi kerak
2. THE Outbox_Dispatcher SHALL OutboxEvent larni poll qilib, tegishli worker larga dispatch qilishi kerak
3. IF dispatch muvaffaqiyatsiz bo'lsa, THEN THE Outbox_Dispatcher SHALL exponential backoff bilan retry qilishi kerak
4. THE Outbox_Dispatcher SHALL har bir OutboxEvent uchun unique idempotencyKey saqlashi kerak
5. WHEN bir xil idempotencyKey bilan ikkinchi event yaratilmoqchi bo'lsa, THE Outbox_Dispatcher SHALL takroriy yozuvni yaratmasligi kerak (ON CONFLICT DO NOTHING)
6. THE Platform SHALL barcha mutating endpointlar uchun Idempotency-Key headerni qo'llab-quvvatlashi kerak (24 soat Redis cache)

### Requirement 19: Idempotency va concurrent request handling

**User Story:** Platforma sifatida men bir xil so'rov ikki marta kelganda ham tizim holatini buzmaslikni xohlayman, shunda network retry va concurrent requestlar xavfsiz bo'ladi.

#### Acceptance Criteria

1. WHEN bir xil Idempotency-Key bilan ikkinchi so'rov kelsa, THE Platform SHALL birinchi so'rov natijasini qaytarishi kerak (cached response)
2. IF bir xil Idempotency-Key bilan boshqa payload kelsa, THEN THE Platform SHALL 409 IDEMPOTENCY_CONFLICT qaytarishi kerak
3. THE Platform SHALL IdempotencyRecord ni 24 soat saqlashi va keyin tozalashi kerak
4. WHEN Payme webhook concurrent kelsa (bir xil paymeId), THE Platform SHALL faqat bitta muvaffaqiyatli tranzaktsiya yaratishi kerak (optimistic locking)
5. THE Platform SHALL enrollment, notification va payment operatsiyalarida idempotent bo'lishi kerak

### Requirement 20: Performance va scalability

**User Story:** Platforma sifatida men yuqori yuklanishda ham tez va barqaror ishlashni ta'minlamoqchiman, shunda 100k+ talaba va 5k+ o'qituvchi muammosiz foydalana oladi.

#### Acceptance Criteria

1. THE Platform SHALL API p95 latency ni 250ms dan past saqlashi kerak
2. THE Platform SHALL lesson page TTI ni 4G da 2 soniyadan past saqlashi kerak
3. THE Platform SHALL 99.9% oylik uptime ni ta'minlashi kerak
4. THE Platform SHALL payment va enrollment operatsiyalari uchun 99.99% atomicity ni ta'minlashi kerak
5. WHILE jonli efir davom etayotganda, THE Live_Module SHALL bitta streamga 500 tagacha izlovchini qo'llab-quvvatlashi kerak
6. WHILE jonli efir davom etayotganda, THE Live_Module SHALL end-to-end kechikishni 1.5 soniyadan past saqlashi kerak
7. THE Platform SHALL read-heavy endpointlar (lesson list, student dashboard) uchun read replica + Redis cache ishlatishi kerak
8. THE Platform SHALL keyset (cursor) pagination ishlatishi kerak (>10k rows bo'lgan jadvallar uchun)

### Requirement 21: Xavfsizlik

**User Story:** Platforma sifatida men OWASP ASVS L2 standartiga mos xavfsizlikni ta'minlamoqchiman, shunda foydalanuvchi ma'lumotlari himoyalangan bo'ladi.

#### Acceptance Criteria

1. THE Platform SHALL barcha parollarni Argon2id bilan hash qilishi kerak
2. THE Platform SHALL JWT access tokenni 15 daqiqa, refresh tokenni 30 kun TTL bilan berishi kerak
3. THE Platform SHALL cookie larni HttpOnly, Secure, SameSite=Lax attributlari bilan o'rnatishi kerak
4. THE Platform SHALL CSRF himoyasi uchun double-submit token ishlatishi kerak
5. THE Platform SHALL Redis token bucket orqali IP va user bo'yicha rate limiting qo'llashi kerak
6. THE Platform SHALL R2 signed URL larni 6 soatdan oshmaydigan TTL bilan berishi kerak
7. THE Platform SHALL Payme webhook uchun Basic Auth + IP allowlist tekshirishi kerak
8. THE Platform SHALL User.phone maydonini pg_crypto bilan field-level encryption qilishi kerak
9. THE Platform SHALL barcha admin va billing mutatsiyalarini audit log ga yozishi kerak
10. THE Platform SHALL O'zbekiston PDP qonuniga muvofiq ma'lumot residencysini hurmat qilishi kerak

### Requirement 22: Reading module — tarjima va lug'at

**User Story:** Talaba sifatida men reading darsida so'z va jumlalarni tez tarjima qilmoqchiman, shunda tushunmaydigan joylarimni darhol o'rganaman.

#### Acceptance Criteria

1. WHEN talaba so'zni hover qilsa, THE AI_Gateway SHALL so'zni kontekst bilan birga tarjima qilishi kerak (translation, partOfSpeech, examples)
2. WHEN talaba jumlani select qilsa, THE AI_Gateway SHALL to'liq jumlani tarjima qilishi kerak
3. THE AI_Gateway SHALL tarjima natijalarini Redis da cache qilishi kerak (so'z: 30 kun, jumla: 7 kun)
4. WHEN cache da natija mavjud bo'lsa, THE AI_Gateway SHALL Claude API ga so'rov yubormasdan cache dan qaytarishi kerak
5. THE AI_Gateway SHALL avval statik lug'atdan tekshirishi kerak, agar topilsa Claude chaqirmasligi kerak

### Requirement 23: Writing module — editor va autosave

**User Story:** Talaba sifatida men writing uy vazifasini rich text editor da yozmoqchiman va har 10 soniyada avtomatik saqlanishini xohlayman, shunda ishim yo'qolmaydi.

#### Acceptance Criteria

1. WHILE talaba writing module da yozayotganda, THE Homework_Module SHALL har 10 soniyada Submission.answersJson ni autosave qilishi kerak
2. THE Homework_Module SHALL writing module uchun version history saqlashi kerak
3. WHEN talaba AI tutor dan yordam so'rasa, THE AI_Gateway SHALL faqat tushuntirish berishi kerak (yakuniy javob emas)
4. WHEN talaba topshirsa, THE Homework_Module SHALL Submission statusini SUBMITTED ga o'zgartirishi kerak

### Requirement 24: Admin panel va specialty boshqaruvi

**User Story:** Admin sifatida men specialty larni va ularning modul katalogini boshqarmoqchiman, shunda platforma turli fanlar uchun moslashtirilgan bo'ladi.

#### Acceptance Criteria

1. WHEN admin yangi specialty yaratsa, THE Admin_Module SHALL Specialty (slug, nameUz, nameRu, nameEn) yaratishi kerak
2. WHEN admin specialty ga modul qo'shsa, THE Admin_Module SHALL SpecialtyModule (specialtyId, moduleType, isActive, defaultEnabled) yaratishi kerak
3. IF specialty da allaqachon 10 ta active modul bo'lsa, THEN THE Admin_Module SHALL yangi modul qo'shishni rad etishi kerak
4. WHEN admin foydalanuvchini suspend qilsa, THE Admin_Module SHALL User.status=SUSPENDED qilib, barcha sessiyalarni bekor qilishi kerak
5. THE Admin_Module SHALL barcha admin harakatlarini AdminAuditLog ga yozishi kerak
6. WHEN admin SpecialtyModule.defaultEnabled ni o'zgartirsa, THE Admin_Module SHALL faqat kelajakda yaratiladigan guruhlarga ta'sir qilishi kerak (mavjud GroupModule larga ta'sir qilmaydi)

### Requirement 25: Error handling va graceful degradation

**User Story:** Platforma sifatida men xatoliklarni to'g'ri boshqarib, foydalanuvchiga tushunarli xabar bermoqchiman, shunda tizim barqaror ishlaydi.

#### Acceptance Criteria

1. WHEN validation xatosi yuz bersa, THE Platform SHALL 400 VALIDATION_FAILED va zod xato tafsilotlarini qaytarishi kerak
2. WHEN state transition noto'g'ri bo'lsa, THE Platform SHALL 409 STATE_TRANSITION_INVALID qaytarishi kerak
3. IF Claude API ishlamay qolsa (timeout yoki 5xx), THEN THE AI_Gateway SHALL degraded mode da ishlashi kerak — tutor "AI offline" xabarini qaytaradi, grading precheck exponential backoff bilan retry qiladi
4. IF R2 upload network uzilishi sababli abort bo'lsa, THEN THE Media_Module SHALL foydalanuvchiga qayta yuklash imkonini berishi kerak
5. IF jonli efir recorder crash bo'lsa, THEN THE Live_Module SHALL supervisor orqali recorder ni qayta ishga tushirishi kerak
6. THE Platform SHALL barcha xatolarni standart JSON envelope formatida qaytarishi kerak: { error: { code, message, details, traceId } }
7. WHEN upstream service (Payme, Claude, SES) xato qaytarsa, THE Platform SHALL 502 UPSTREAM_ERROR qaytarishi kerak

### Requirement 26: Observability va monitoring

**User Story:** DevOps jamoasi sifatida men platformaning ishlash holatini real-time kuzatmoqchiman, shunda muammolarni tezda aniqlab hal qilaman.

#### Acceptance Criteria

1. THE Platform SHALL barcha loglarni structured JSON formatida (pino) yozishi va trace-id propagation qilishi kerak
2. THE Platform SHALL Prometheus metrics (RED + USE) expose qilishi kerak
3. THE Platform SHALL OpenTelemetry orqali Prisma, Redis, R2 va Claude chaqiruvlarini trace qilishi kerak
4. THE Platform SHALL Sentry orqali frontend va backend xatolarini capture qilishi kerak
5. WHEN payment webhook 5xx > 1% (5 daqiqa ichida) bo'lsa, THE Platform SHALL alert yuborishi kerak
6. WHEN outbox dispatcher lag > 5 daqiqa bo'lsa, THE Platform SHALL alert yuborishi kerak
7. WHEN AI daily budget oshsa, THE Platform SHALL alert yuborishi kerak

### Requirement 27: Advanced Threat Protection va Intrusion Detection

**User Story:** Platforma sifatida men real-time tahdidlarni aniqlash va bloklash tizimiga ega bo'lmoqchiman, shunda hujumchilar tizimga zarar yetkaza olmaydi va barcha anomal harakatlar darhol aniqlanadi.

#### Acceptance Criteria

1. THE Platform SHALL Cloudflare WAF qoidalari orqali OWASP Top 10 hujumlarini (SQL injection, XSS, path traversal, RCE) application layer da real-time bloklashi kerak
2. THE Platform SHALL DDoS himoyasi uchun Cloudflare network-level protection va application-level rate limiting (Redis token bucket: IP bo'yicha 1000 req/min, user bo'yicha 300 req/min) ni birgalikda qo'llashi kerak
3. WHEN foydalanuvchi login qilganda geographic anomaly aniqlansa (oldingi login dan 500km+ masofada 1 soat ichida — impossible travel), THE Auth_Module SHALL sessiyani bloklashi va MFA qayta tekshiruvini talab qilishi kerak
4. WHEN foydalanuvchi 5 marta ketma-ket noto'g'ri parol kiritsa, THE Auth_Module SHALL akkauntni 30 daqiqaga vaqtincha bloklashi va CAPTCHA (hCaptcha) ni yoqishi kerak
5. WHEN bloklangan akkauntga yana 3 marta noto'g'ri urinish bo'lsa, THE Auth_Module SHALL akkauntni to'liq bloklashi va admin xabardor qilishi kerak
6. THE Platform SHALL bot detection uchun behavioral analysis (mouse movement patterns, typing speed, request timing) va device fingerprinting ni qo'llashi kerak
7. THE Platform SHALL barcha xavfsizlik hodisalarini SIEM tizimiga (ELK Stack yoki Grafana Loki + alerting) real-time yuborishi va korrelyatsiya qilishi kerak
8. THE Platform SHALL honeypot endpointlar (/admin-backup, /wp-login.php, /.env) orqali hujumchilarni aniqlashi va ularning IP larini avtomatik bloklashi kerak
9. WHEN bitta IP dan 10+ turli akkauntga login urinishi aniqlansa (credential stuffing), THE Auth_Module SHALL o'sha IP ni 24 soatga bloklashi kerak
10. THE Platform SHALL real-time threat intelligence feed (AbuseIPDB, Spamhaus) orqali ma'lum zararli IP larni proaktiv bloklashi kerak

### Requirement 28: Data Protection va Encryption

**User Story:** Platforma sifatida men barcha sezgir ma'lumotlarni eng yuqori darajada shifrlashni xohlayman, shunda ma'lumotlar bazasi yoki disk o'g'irlansa ham foydalanuvchi ma'lumotlari himoyalangan bo'ladi.

#### Acceptance Criteria

1. THE Platform SHALL barcha sezgir ma'lumotlarni (PII, to'lov ma'lumotlari, parollar) saqlashda AES-256-GCM algoritmi bilan shifrlashi kerak (at-rest encryption)
2. THE Platform SHALL barcha tarmoq ulanishlarida TLS 1.3 ni majburiy qo'llashi kerak va TLS 1.2 yoki undan past versiyalarga fallback ni to'liq taqiqlashi kerak
3. THE Platform SHALL ma'lumotlar bazasida User.phone, User.address, PaymeTransaction.cardLastFour maydonlarini column-level encryption (pgcrypto + application-layer envelope encryption) bilan shifrlashi kerak
4. THE Platform SHALL shifrlash kalitlarini har 90 kunda avtomatik ravishda rotate qilishi kerak va eski kalitlar bilan shifrlangan ma'lumotlarni yangi kalit bilan qayta shifrlashi kerak (zero-downtime rotation)
5. THE Platform SHALL barcha shifrlash kalitlarini HashiCorp Vault yoki AWS KMS da saqlashi kerak — hech qachon source code, environment variable yoki config faylda plaintext kalit bo'lmasligi kerak
6. THE Platform SHALL log va error message larda PII ma'lumotlarni (email, phone, IP, card number) avtomatik masklashi kerak (masalan: "user@..." → "u***@...", phone → "***1234")
7. WHEN foydalanuvchi o'z ma'lumotlarini o'chirishni so'rasa, THE Platform SHALL crypto-shredding usuli bilan (foydalanuvchiga tegishli encryption key ni yo'q qilish orqali) barcha sezgir ma'lumotlarni qaytarib bo'lmas tarzda o'chirishi kerak
8. THE Platform SHALL database backup larni ham AES-256 bilan shifrlashi va backup kalitlarini asosiy ma'lumotlar kalitlaridan alohida saqlashi kerak
9. THE Platform SHALL certificate pinning ni mobile va API client larda qo'llashi kerak (MITM hujumlarini oldini olish)
10. THE Platform SHALL Secure Enclave / HSM orqali eng muhim kalitlarni (master key) himoyalashi kerak

### Requirement 29: Authentication Hardening va Zero Trust

**User Story:** Platforma sifatida men autentifikatsiya tizimini dunyodagi eng kuchli standartlarga mos qilmoqchiman, shunda hatto parol o'g'irlansa ham akkauntga ruxsatsiz kirish imkonsiz bo'ladi.

#### Acceptance Criteria

1. THE Platform SHALL Teacher va Admin rollari uchun MFA ni majburiy qilishi kerak (TOTP asosiy, SMS fallback sifatida)
2. THE Platform SHALL har bir qurilmani fingerprint (browser fingerprint + hardware identifiers) orqali aniqlashi va trusted device ro'yxatini boshqarishi kerak
3. WHEN foydalanuvchi sessiyasi davomida IP yoki User-Agent o'zgarsa, THE Auth_Module SHALL sessiyani to'xtatishi va qayta autentifikatsiyani talab qilishi kerak
4. THE Platform SHALL adaptive authentication (risk-based step-up) ni qo'llashi kerak — yuqori xavfli operatsiyalar (to'lov, parol o'zgartirish, admin harakatlar) uchun qo'shimcha tekshiruv talab qilishi kerak
5. THE Platform SHALL parol siyosatini quyidagicha majburiy qilishi kerak: minimum 12 belgi, katta va kichik harf, raqam, maxsus belgi, va HaveIBeenPwned API orqali buzilgan parollar bazasida tekshirish
6. WHEN foydalanuvchi akkauntni tiklashni so'rasa, THE Auth_Module SHALL ko'p bosqichli identifikatsiya tekshiruvini (email + telefon + xavfsizlik savollari) talab qilishi kerak
7. THE Platform SHALL Admin rollari uchun hardware kalit (WebAuthn/FIDO2) orqali autentifikatsiyani majburiy qilishi kerak — faqat parol bilan admin panelga kirish imkonsiz bo'lishi kerak
8. THE Platform SHALL Zero Trust prinsipi asosida har bir API so'rovni autentifikatsiya va avtorizatsiya qilishi kerak — ichki tarmoqdan kelgan so'rovlar ham tekshirilishi kerak
9. WHEN yangi qurilmadan login qilinsa, THE Auth_Module SHALL foydalanuvchiga email orqali xabarnoma yuborishi va qurilmani tasdiqlashni so'rashi kerak
10. THE Platform SHALL session fixation va session hijacking hujumlarini oldini olish uchun har bir muvaffaqiyatli login da yangi session ID generatsiya qilishi kerak

### Requirement 30: API Security va Input Validation

**User Story:** Platforma sifatida men barcha API endpointlarni eng yuqori darajada himoyalamoqchiman, shunda hech qanday zararli so'rov tizimga zarar yetkaza olmaydi.

#### Acceptance Criteria

1. THE Platform SHALL kritik endpointlar (payment, enrollment, admin operations) uchun request signing (HMAC-SHA256) ni qo'llashi kerak — imzosiz yoki noto'g'ri imzoli so'rovlar 401 qaytarilishi kerak
2. THE Platform SHALL barcha foydalanuvchi kiritgan ma'lumotlarni XSS, SQL injection, NoSQL injection va command injection ga qarshi sanitize qilishi kerak (DOMPurify + parameterized queries + input validation)
3. THE Platform SHALL barcha HTTP javoblarda quyidagi xavfsizlik headerlarini o'rnatishi kerak: Content-Security-Policy (strict), X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, Permissions-Policy
4. THE Platform SHALL API versioning (v1, v2) va deprecation policy (minimum 6 oy oldindan ogohlantirish) ni qo'llashi kerak
5. THE Platform SHALL request size limitlarini qo'llashi kerak: body maximum 10MB, headers maximum 8KB, URL maximum 2048 belgi
6. THE Platform SHALL GraphQL query depth limiting (maximum 7 daraja) va complexity analysis (maximum 1000 ball) ni qo'llashi kerak — limitdan oshgan so'rovlar 413 QUERY_TOO_COMPLEX qaytarilishi kerak
7. THE Platform SHALL har bir endpoint uchun zod schema validation ni qo'llashi kerak — validatsiyadan o'tmagan maydonlar hech qachon controller ga yetib bormasligi kerak (strict mode, no passthrough)
8. THE Platform SHALL CORS policy ni faqat ruxsat etilgan domenlar (edubridge.uz, *.edubridge.uz) uchun ochishi kerak — boshqa domenlardan kelgan so'rovlar bloklanishi kerak
9. WHEN API response da xatolik qaytarilsa, THE Platform SHALL hech qachon stack trace, internal path yoki database schema ma'lumotlarini expose qilmasligi kerak
10. THE Platform SHALL barcha file upload larni content-type validation (magic bytes tekshiruvi) va antivirus scanning (ClamAV) dan o'tkazishi kerak

### Requirement 31: Supply Chain Security va Infrastructure Hardening

**User Story:** Platforma sifatida men dasturiy ta'minot yetkazib berish zanjiri va infratuzilmani himoyalamoqchiman, shunda hatto dependency yoki container image buzilsa ham tizim xavfsiz qoladi.

#### Acceptance Criteria

1. THE Platform SHALL barcha dependency larni Snyk va Dependabot orqali avtomatik skanerlashi va critical/high CVE topilganda deployment ni bloklashi kerak
2. THE Platform SHALL har bir container image ni deployment oldidan Trivy orqali vulnerability scanning dan o'tkazishi kerak — critical zaiflik topilsa deploy to'xtatilishi kerak
3. THE Platform SHALL barcha production container image larni cosign (Sigstore) orqali imzolashi kerak va imzolanmagan image lar deploy qilinmasligi kerak
4. THE Platform SHALL immutable infrastructure prinsipi asosida ishlashi kerak — production serverlarga SSH kirish to'liq taqiqlanishi va barcha o'zgarishlar faqat GitOps (ArgoCD/Flux) orqali amalga oshirilishi kerak
5. THE Platform SHALL network segmentation ni qo'llashi kerak — database serverlari faqat application pod lardan accessible bo'lishi, public internet dan to'g'ridan-to'g'ri kirish imkonsiz bo'lishi kerak
6. THE Platform SHALL barcha secretlarni (API keys, DB passwords, encryption keys) faqat HashiCorp Vault yoki AWS Secrets Manager orqali boshqarishi kerak — source code, Docker image yoki environment file da hardcoded secret bo'lmasligi kerak
7. THE Platform SHALL har bir release uchun SBOM (CycloneDX formatida) generatsiya qilishi va saqlashi kerak
8. THE Platform SHALL base image larni minimal (distroless/Alpine) va pinned version (sha256 digest) sifatida ishlatishi kerak
9. THE Platform SHALL Kubernetes Pod Security Standards (restricted profile) ni qo'llashi kerak — privileged container, host network, root user bilan ishlash taqiqlanishi kerak
10. THE Platform SHALL infrastructure drift detection ni qo'llashi kerak — manual o'zgarishlar aniqlansa alert yuborishi va avtomatik rollback qilishi kerak

### Requirement 32: Compliance, Audit va Incident Response

**User Story:** Platforma sifatida men xalqaro xavfsizlik standartlariga mos kelishni va har qanday xavfsizlik hodisasiga tezkor javob berishni ta'minlamoqchiman, shunda foydalanuvchilar ishonchi saqlanadi va qonuniy talablar bajariladi.

#### Acceptance Criteria

1. THE Platform SHALL SOC 2 Type II compliance uchun zarur barcha nazorat mexanizmlarini (access control, change management, risk assessment, incident response) joriy qilishi kerak
2. THE Platform SHALL GDPR-style data subject rights ni to'liq qo'llab-quvvatlashi kerak: ma'lumotlarga kirish huquqi (access), tuzatish (rectification), o'chirish (erasure), ko'chirish (portability) — har bir so'rov 30 kun ichida bajarilishi kerak
3. THE Platform SHALL barcha sezgir operatsiyalar (login, logout, permission change, data access, payment, admin action) uchun to'liq audit trail saqlashi kerak: kim (userId), nima (action), qachon (timestamp), qayerdan (IP, device), nima uchun (reason/context)
4. THE Platform SHALL audit loglarni tamper-proof qilishi kerak — append-only storage, cryptographic hash chaining (har bir yozuv oldingi yozuv hash ini o'z ichiga oladi) va alohida immutable storage (S3 Object Lock yoki WORM)
5. THE Platform SHALL CI/CD pipeline da avtomatik xavfsizlik skanerlashni qo'llashi kerak: SAST (SonarQube/Semgrep), DAST (OWASP ZAP), SCA (Snyk) — critical finding topilsa pipeline to'xtatilishi kerak
6. THE Platform SHALL incident response playbook ni avtomatlashtirilgan tarzda qo'llashi kerak: anomaly detection → alert (PagerDuty/Opsgenie, 5 daqiqa ichida) → triage → containment (avtomatik IP block, session revoke) → eradication → recovery → post-mortem
7. THE Platform SHALL har chorakda (quarterly) professional penetration testing o'tkazishi va topilgan zaifliklarni quyidagi SLA bilan tuzatishi kerak: critical — 24 soat, high — 7 kun, medium — 30 kun, low — 90 kun
8. THE Platform SHALL securityheaders.com da A+ ball olishi kerak (barcha xavfsizlik headerlari to'g'ri sozlangan)
9. THE Platform SHALL yiliga kamida 2 marta mustaqil tashqi xavfsizlik auditi (third-party security audit) o'tkazishi va natijalarni boshqaruv jamoasiga taqdim etishi kerak
10. THE Platform SHALL data breach notification jarayonini avtomatlashtirilgan qilishi kerak — breach aniqlangandan keyin 72 soat ichida tegishli organlar va ta'sirlangan foydalanuvchilarga xabarnoma yuborilishi kerak
