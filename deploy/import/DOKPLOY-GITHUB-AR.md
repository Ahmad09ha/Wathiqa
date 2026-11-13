# نشر وثيقة على Hostinger VPS باستخدام Dokploy و GitHub

## أهم قرار: استخدم Compose وليس Dockerfile واحداً
المشروع الحالي يضم Frontend (Next.js 16) وImport API (.NET 10) وPostgreSQL 18، ويحتاج مخزناً دائماً خاصاً للمستندات ومفاتيح الجلسات. لدى كل من API وWeb ملف Dockerfile منفصل:

- `deploy/import/Dockerfile.api`
- `deploy/import/Dockerfile.web`
- `deploy/import/compose.yml` هو نقطة نشر جميع الخدمات في Dokploy.
- لا تنشر `docker-compose.yml` الموجود بجذر المشروع: يخص قاعدة المحرر القديم. ولا تشغّل `backend/Wathiqa.Api` (.NET 9) أمام الإنترنت.

> **تنبيه أمني:** الكود جاهز للتحضير إلى staging، وليس شهادة جاهزية للإطلاق العام. تشغيل الحاويات لا يُثبت فاعلية فحص الفيروسات أو النسخ الاحتياطي أو العزل. اتبع `RELEASE-RUNBOOK.md` قبل إطلاق بيانات الزبائن.

## 1) راجع الفرع في GitHub
الفرع الذي فُحص محلياً: `feature/import-management-mvp`، وهو الذي يحتوي إعدادات نشر Import. اختر الفرع الذي يحتوي التعديلات بعد دفعها إلى GitHub. لا تستخدم `main` القديم إذا كان لا يحتوي المشروع الجديد.

## 2) جهّز VPS من SSH
على VPS ثبّت Docker + Dokploy. اختر مجلداً مؤقتاً لنسخة المستودع بغرض تجهيز الأسرار وتشغيل أوامر الإدارة فقط؛ ويمكن لـ Dokploy أن يسحب الكود بنفسه عبر GitHub. نفّذ أوامر النشر من **جذر المستودع**.

افحص شبكات Docker الموجودة قبل تحديد الشبكة الخاصة:

```bash
docker network ls
docker network inspect dokploy-network
docker network inspect bridge
```

حضّر الإعدادات باستخدام المثال `deploy/import/.env.example`. اختر `WATHIQA_PRIVATE_SUBNET` غير المتداخل مع أي شبكة على الجهاز، و`WATHIQA_WEB_IP` داخلها، مثل القيم التجريبية في الملف **فقط بعد التحقق**. ستستخدم القيم نفسها في Dokploy > Environment.

```bash
cp deploy/import/.env.example deploy/import/.env
nano deploy/import/.env
sudo bash deploy/import/provision-vps.sh
```

سيُطلب 3 عناوين بريد *مختلفة* لحساب Admin التجريبي، Admin الدائم، وSuperAdmin. سيُنشئ السكربت كلمات مرور عشوائية قوية، وشهادة خاصة بتشفير Data Protection، ويخزنها خارج Git داخل `/opt/wathiqa/import-secrets`. لا ترسل هذه الملفات لأحد، ولا تطبع كلمات المرور في سجل Dokploy. تستطيع استرجاع كلمة مرور الحساب المطلوبة عبر SSH بصلاحيات root من الملف المقابل وتغييرها لاحقاً عبر إجراء إداري آمن.

السكربت قابل لإعادة التشغيل ولا يستبدل الأسرار الموجودة. **لا تمسح** مجلد `/opt/wathiqa/import-private` أو مفتاح PFX القديم؛ فقد يؤثر ذلك على إمكانية فتح الجلسات أو البيانات المستعادة.

## 3) أضف تطبيق Compose في Dokploy

1. Project > Create Service > **Compose** (وليس Application بملف Dockerfile واحد).
2. Source: GitHub، اختر Repository الخاص بـ Hussam/Wathiqa والفرع `feature/import-management-mvp` بعد نشر التعديلات.
3. Compose file path: `deploy/import/compose.yml`، مع دعم Dokploy للمسار النسبي والبناء باستخدام context `../..`. إذا كان واجهتك تتطلب تحديد Base Directory، يجب أن تنتهي سياقات البناء بجذر المستودع؛ تأكد من ذلك في Build Logs.
4. Environment: أدخل محتوى `deploy/import/.env` **كقيم خاصة بالخادم**، مع `WATHIQA_PRIVATE_ROOT`, `WATHIQA_SECRETS_ROOT`, `WATHIQA_PRIVATE_SUBNET`, `WATHIQA_WEB_IP`. لا تضف كلمات المرور كنص في Compose.
5. عند إضافة Domain، اربطه حصراً بخدمة `web` على المنفذ الداخلي **3000**؛ فعّل HTTPS/Let's Encrypt. اترك خدمات `api`, `postgres`, `clamav-signatures` دون Domain أو Port منشور.
6. ابدأ أولاً على **staging domain**. بعد حل البوابات الأمنية/التشغيلية يمكن التفكير بالنشر العام.

مهم: الملفات السرية معرفة كمسارات مطلقة على الخادم في Compose. يجب أن تكون موجودة فعلياً على **نفس VPS** الذي ينفّذ Docker.

## 4) جهّز قاعدة البيانات والحسابات أول مرة

قبل أول تشغيل كامل، تأكد أن `postgres` صحي وأن حاوية تحديث توقيعات ClamAV بدأت. يمكن استخدام أوامر Docker Compose التالية من نسخة المستودع على نفس VPS إن كانت هي مشروع Compose الوحيد؛ **لا تنشئ نسختين مختلفتين بواسطـة CLI وDokploy**. إذا يدير Dokploy الحاويات، شغّل العمليات من طرف مشروع Compose نفسه أو نفّذ `docker compose -p <اسم مشروع Dokploy>` بعناية بعد معرفة اسم المشروع الحقيقي، وتجنب إنشاء stack ثانية.

```bash
docker compose --env-file deploy/import/.env -f deploy/import/compose.yml config --quiet
```

عندما تكون الخدمات مشتركة ضمن **نفس Compose project** شغّل أوامر bootstrap كـ one-shot من Docker Compose المقابل له:

```bash
docker compose --env-file deploy/import/.env -f deploy/import/compose.yml run --rm api --seed-access-accounts
docker compose --env-file deploy/import/.env -f deploy/import/compose.yml run --rm api --seed-superadmin
```

هذه الأوامر تطبق EF Migrations وتنشئ حسابين منفصلين للتجار وحساب SuperAdmin خاصاً بالمنصة. الحساب التجريبي مدته 3 أشهر من أول إنشاء، والثاني غير محدد الانتهاء. لا تتكرر عملية تغيير كلمات المرور أو تمديد المدة عند إعادة Seed.

بعد ذلك، شغّل `api` ثم `web` وتأكد من أن صفحات الدخول تعمل:
- `https://YOUR-DOMAIN/import/login`
- `https://YOUR-DOMAIN/platform/login`
- `https://YOUR-DOMAIN/import-api/api/health`

**تحديث قاعدة البيانات التلقائي:** عند كل Deploy للـ Import API يتم تطبيق EF Migrations المعلّقة تلقائياً قبل فتح السيرفر لاستقبال الطلبات. هذا مفعّل افتراضياً عبر `WATHIQA_IMPORT_AUTO_MIGRATE=true`. الواجهة تنتظر نجاح فحص جاهزية API؛ وفشل Migration يمنع تشغيل API على مخطط قديم. لا يتم إنشاء حسابات أو تغيير كلمات مرور تلقائياً، ولا يتم إنشاء نسخة احتياطية تلقائياً. راجع `RELEASE-RUNBOOK.md` قبل نشر Migrations حساسة.

لا تستعمل دومين الإنتاج قبل اكتمال التحقق.

## 5) تحقّق من المخرجات
على الـ VPS:

```bash
bash -n deploy/import/*.sh scripts/vps/backup-import.sh scripts/vps/restore-rehearsal.sh
docker compose --env-file deploy/import/.env -f deploy/import/compose.yml config --quiet
WATHIQA_PUBLIC_BASE_URL=https://YOUR-STAGING-DOMAIN bash deploy/import/smoke-public.sh
```

اختبر تسجيل الدخول على كلا اللوحتين، العزل بين التاجر والـ SuperAdmin، وحفظ ملف مستند ثم إعادة تشغيل API والعودة إليه. تأكد أن الواجهة لم تكشف Routes المحرر القديم. السكربت `smoke-public.sh` يختبر نقاطاً منها منع الوصول للبيانات دون جلسة صحيحة.

## 6) النسخ الاحتياطي (مطلوب قبل الإنتاج)
الـ backup ضمن ملف Compose خدمة `ops` اختيارية، **لا تعمل تلقائياً**. لإنجازها يجب تحديد `RESTIC_REPOSITORY` إلى وجهة خارج VPS، وإضافة `import_s3_access_key` و`import_s3_secret_key` الحقيقيين إذا استخدمت S3. لا تضع بيانات وصول مزيفة بغرض اجتياز الفحص.

بعد تهيئة وجهة restic المشفّرة:

```bash
docker compose --env-file deploy/import/.env -f deploy/import/compose.yml --profile ops run --rm backup
```

يتبقى إعداد جدولة ومراقبة النسخ وتحديد سياسة الاحتفاظ **واختبار Restore على خادم منفصل**. لا تعتبر نجاح backup وحده دليلاً على قابلية استرجاع البيانات.

## 7) بوابات إيقاف الإصدار العام
الإطلاق العام يظل **موقوفاً** إلى أن تتأكد عملياً من: Docker build حقيقي على VPS، HTTPS وSecure cookies مع trusted proxy، فحص ClamAV فعلي بتوقيعات حديثة واختبار EICAR آمن، النسخ المشفرة خارج الخادم واستعادة مستقلة، اختبار العملاء/المستندات والوظائف المالية على staging، وإجراء معتمد لاسترجاع حساب مالك المنصة.

التفاصيل وقرارات الأمان والإصدار: `deploy/import/RELEASE-RUNBOOK.md`.
