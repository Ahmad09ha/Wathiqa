# تشغيل وثيقة محلياً — دليل المطوّر الجديد (Windows)

> **ابدأ من هنا إذا استلمت المشروع لأول مرة.**
>
> هذا الدليل مخصص لنسخة **Wathiqa Import Management + Platform SuperAdmin** الموجودة على الفرع `feature/import-management-mvp`. الخطوات تعتمد على سكريبتات Windows/PowerShell الموجودة في المستودع، ولا تحتاج Docker أو VPS. لا تشغّل محرّر المستندات القديم حتى تجرب المنصة الحالية.

## 1. شو لازم يكون مثبّت على الجهاز؟

| البرنامج | المطلوب | ملاحظات |
|---|---|---|
| **Git** | نسخة حديثة | لتنزيل المستودع وتحديثه |
| **.NET SDK 10** | إلزامي | `global.json` يطلب SDK `10.0.100` مع `rollForward: latestFeature`؛ لازم نسخة SDK 10 متوافقة، مو Runtime فقط |
| **Node.js 22 أو أحدث + npm** | إلزامي | الواجهة Next.js 16.4.5 |
| **PostgreSQL 18 for Windows** | إلزامي | السكريبتات تتوقعه حرفياً في `C:\Program Files\PostgreSQL\18\bin` |
| **PowerShell** | Windows PowerShell 5.1 أو أحدث | الأوامر أدناه تُنفّذ من PowerShell |
| **Rider / VS Code** | اختياري | محرر للكود |

افتح PowerShell واختبر:

```powershell
git --version
dotnet --version
dotnet --list-sdks
node --version
npm.cmd --version
Test-Path 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'
```

آخر أمر لازم يعطي `True`. إذا PostgreSQL مثبت بمسار مختلف، **السكريبتات الحالية تحتاج تعديل مسار PostgreSQL** قبل التشغيل؛ لا تحاول حذف قاعدة موجودة لإصلاح مشكلة المسار.

## 2. تنزيل المشروع لأول مرة

```powershell
git clone --branch feature/import-management-mvp --single-branch https://github.com/Ahmad09ha/Wathiqa.git
cd .\Wathiqa
git branch --show-current
```

الناتج الأخير لازم يكون `feature/import-management-mvp`. **كل الأوامر التالية تُنفّذ من مجلد المشروع الرئيسي** (`Wathiqa`) وليس من مجلد `frontend` أو `backend`، إلا إذا ذُكر العكس.

إذا عندك نسخة مستنسخة مسبقاً، تأكد أنك على الفرع الصحيح ثم حدثه:

```powershell
git switch feature/import-management-mvp
git pull --ff-only origin feature/import-management-mvp
```

> نفّذ `git pull` فقط بعد حفظ شغلك المحلي أو إنهاء أي تغييرات غير محفوظة؛ لا تستخدم `git reset --hard` للتحديث.

## 3. استعادة أدوات .NET والـFrontend

```powershell
dotnet tool restore
dotnet restore .\backend\Wathiqa.ImportApi\Wathiqa.ImportApi.csproj
dotnet build .\backend\Wathiqa.ImportApi\Wathiqa.ImportApi.csproj -c Debug

npm.cmd --prefix .\frontend ci
```

- `dotnet tool restore` يثبّت أداة `dotnet-ef` بحسب ملف `.config/dotnet-tools.json`.
- **ابنِ `Debug` قبل تطبيق الـMigrations أو إنشاء الحسابات**؛ سكريبتات Windows تستخدم ملف `backend/Wathiqa.ImportApi/bin/Debug/net10.0/Wathiqa.ImportApi.dll`، وسكريبت الـMigration يستخدم `--no-build`.
- `npm ci` يثبّت نسخ الحزم المثبتة في `frontend/package-lock.json`. لا داعي لتنصيب الحزم أو تغيير إصداراتها يدوياً.
- لا تحتاج إنشاء `.env` لتشغيل الواجهة والـAPI على نفس جهاز Windows: إعداد Next.js الحالي يوجّه `/import-api/*` داخلياً إلى `http://127.0.0.1:5089` افتراضياً. ملف `frontend/.env.example` للشرح فقط؛ لا تنسخ قيمة `NEXT_PUBLIC_API_URL` القديمة على أنها API الاستيراد الجديد.

## 4. إنشاء PostgreSQL المحلي الخاص بالمشروع

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Initialize-LocalPostgres.ps1
```

السكريبت ينشئ **Cluster محلي مستقل** داخل `.local/pgdata` على:

- Host: `127.0.0.1`
- Port: `55432` (مو منفذ PostgreSQL الافتراضي `5432`)
- ملفات قاعدة البيانات وكلمات المرور: داخل `.local/`؛ **غير مرفوعة على GitHub**.

السكريبت قد ينشئ أيضاً قاعدة محرر الوثائق القديمة `wathiqa_docs` لأسباب توافق تاريخية، لكن **مشروع الاستيراد الجديد لا يستخدمها**. بيانات وثيقة الحالية في قاعدة منفصلة اسمها `wathiqa_import_dev` وبمستخدم `wathiqa_import_dev`.

طبق الـMigrations على **قاعدة الاستيراد فقط**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Apply-ImportMigrations.ps1
```

النتيجة المطلوبة: `IMPORT_MIGRATIONS_APPLIED_ONLY_TO=wathiqa_import_dev`. هذا يشمل جداول الشركات والمستخدمين والطلبات والشحنات والمحاسبة، ولوحة SuperAdmin والباقات والاشتراكات اليدوية. لا تشغّل Migrations قاعدة الاستيراد على `wathiqa_docs` أو `hussam_templates`.

> **مهم:** أوامر التهيئة وإعادة تطبيق الـMigrations مصممة للعمل على قاعدة التطوير نفسها بدون حذفها. لا تحذف مجلد `.local/pgdata` ولا تعيد إنشاء قواعد البيانات أثناء العمل؛ ذلك قد يضيع بياناتك المحلية.

## 5. إنشاء حسابات تجريبية محلية

### أ. حسابا مديرَي التاجر

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Seed-ImportAccessAccounts.ps1
```

سينشأ حسابان منفصلان في Tenant مختلف لكل واحد:

| البريد المحلي | نوع الوصول |
|---|---|
| `trial-admin@wathiqa.invalid` | 3 أشهر من **أول** إنشاء للتاجر |
| `unlimited-admin@wathiqa.invalid` | بلا تاريخ انتهاء |

كلمات المرور العشوائية الخاصة **بجهازك** محفوظة في:

```text
.local/import-access-accounts.json
```

### ب. حساب إدارة المنصة — SuperAdmin

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Seed-LocalPlatformSuperAdmin.ps1
```

- البريد: `local-superadmin@wathiqa.invalid`
- كلمة المرور العشوائية تُولّد **على جهازك** وتحفظ في:

```text
.local/platform-superadmin-account.json
```

افتح الملف محلياً في Rider/محرر نصوص، واستخدم قيمة `password`. **لا تنسخ ملفات `.local` من جهاز زميلك ولا ترفعها إلى GitHub**. إعادة تنفيذ سكريبتات الـSeed لا تعيد ضبط كلمات مرور الحسابات الموجودة أو تمدد فترة الحساب التجريبي؛ إذا فقدت بيانات الدخول لقاعدة موجودة، لا تحذف القاعدة لحل المشكلة.

> حساب `SuperAdmin` مستقل كلياً عن `Admin` التاجر. اشتراكات وثيقة يدوية بالكامل من لوحة المنصة، **بدون دفع أو فواتير أو تحصيل**. سجلات حوالات الاستيراد للتاجر جزء مختلف عن اشتراكات المنصة.

## 6. بناء واجهة Next.js

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build-ImportFrontend.ps1
Get-Content .\.local\import-frontend-build-exit.txt
```

الناتج المطلوب من آخر أمر: **`0`**. إذا فشل البناء، افتح `.local/import-frontend-build.log` لمعرفة السبب. هذا البناء مطلوب لأن سكريبت التشغيل يستخدم `next start` وليس `next dev`.

## 7. تشغيل المشروع (بعد التجهيز الأول)

من **مجلد المشروع الرئيسي**، شغّل هذين الأمرين بالترتيب:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-ImportApi.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Web.ps1
```

الـAPI يهيّئ اتصال قاعدة الاستيراد عند التشغيل، ويتأكد من نجاح Health Check. الواجهة تعمل على نسخة Next.js المبنية. تظل الخدمتان شغالتين في عمليات محلية مستقلة بعد انتهاء أوامر التشغيل.

### الروابط المحلية

| الصفحة أو الخدمة | الرابط |
|---|---|
| **تسجيل دخول التاجر** | http://localhost:3000/import/login |
| **لوحة SuperAdmin** | http://localhost:3000/platform/login |
| إدارة الباقات | http://localhost:3000/platform/plans |
| إدارة الاشتراكات اليدوية | http://localhost:3000/platform/subscriptions |
| **Import API Health** | http://127.0.0.1:5089/api/health |

تأكد من الـAPI:

```powershell
Invoke-RestMethod http://127.0.0.1:5089/api/health
```

يفترض أن تعيد حالة `status: ok` واتصال قاعدة `database: connected`.

**لا تستخدم `.\start.ps1` كطريقة تشغيل أساسية لمشروع الاستيراد الجديد**؛ ذلك السكريبت تاريخي ويطلب أيضاً بناء/تشغيل الـLegacy Editor API على `5088`. الأوامر أعلاه تشغّل النظام الحالي فقط.

## 8. الإيقاف وإعادة التشغيل

إيقاف Import API:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Stop-ImportApi.ps1
```

إيقاف واجهة `next start` التي بدأها السكريبت:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\stop.ps1
```

> `stop.ps1` القديم لا يوقف Import API على `5089`؛ لذلك استخدم **الأمرين** عند إنهاء العمل. وهو يحتفظ بقاعدة PostgreSQL قيد التشغيل افتراضياً. إذا أردت إيقاف قاعدة المشروع أيضاً، يمكن تشغيل `stop.ps1 -StopDatabase` بعد إيقاف الـAPI؛ البيانات تبقى محفوظة على القرص.

إذا عدّلت C#، أوقف Import API أولاً، ثم أعد `dotnet build ... -c Debug` وشغّل `Start-ImportApi.ps1`. إذا عدّلت الواجهة، أوقف الويب وأعد `Build-ImportFrontend.ps1` ثم `Start-Web.ps1`.

## 9. مشاكل شائعة

| المشكلة | الحل |
|---|---|
| `initdb.exe` أو `pg_ctl.exe` غير موجود | تأكد أن PostgreSQL 18 مثبت في `C:\Program Files\PostgreSQL\18\bin`، أو عدّل المسارات في السكريبتات قبل التهيئة |
| المنفذ `55432` مستخدم | يوجد PostgreSQL آخر على نفس المنفذ؛ لا تشغّل قاعدتين على نفس المنفذ ولا تحذف البيانات |
| `dotnet-ef` غير موجود | نفّذ `dotnet tool restore` من جذر المستودع |
| `A compatible .NET SDK was not found` أو يطلب `10.0.100` | ثبّت **.NET 10 SDK** المتوافق مع `global.json` وتأكد أنه يظهر في `dotnet --list-sdks`؛ وجود SDK 9 وحده لا يكفي |
| الـMigration تقول لا يوجد Build أو تغييرات غير ظاهرة | نفّذ `dotnet build .\backend\Wathiqa.ImportApi\Wathiqa.ImportApi.csproj -c Debug` أولاً؛ سكريبت الترحيل يعمل بـ`--no-build` |
| الواجهة تفشل أو لا يوجد `.next/BUILD_ID` | نفّذ `npm.cmd --prefix .\frontend ci` ثم `Build-ImportFrontend.ps1`، وافتح سجل البناء في `.local` |
| `5089` أو `3000` مستخدم | افحص `Get-NetTCPConnection -LocalPort 5089,3000 -State Listen`، ولا توقف عمليات عشوائية |
| تسجيل دخول التاجر يعطي `account_expired` | جرّب الحساب غير المحدد المدة؛ انتهاء التجريبي بعد 3 أشهر متوقع، أو اطلب من SuperAdmin إدارة وصول التاجر |
| بيانات SuperAdmin لا تعمل | تأكد من تشغيل سكريبت الـSeed وراجع ملف كلمات المرور **المحلي**. إعادة الـSeed لا تعيد تعيين كلمة مرور موجودة |
| الـBackend يبدأ ثم يفشل | راجع `.local/import-api-error.log` و`.local/import-api.log` |
| الـFrontend يرجع خطأ | راجع `.local/web-error.log` و`.local/web.log`، وتأكد أن Import API على `5089` |
| بيظهر محرر الوثائق القديم أو API `5088` | استخدمت سكريبتاً تاريخياً؛ استخدم `Start-ImportApi.ps1` و`Start-Web.ps1` فقط |

## 10. فحص سريع قبل تسليم المهمة

```powershell
npm.cmd --prefix .\frontend run lint
dotnet build .\backend\Wathiqa.ImportApi\Wathiqa.ImportApi.csproj -c Debug
git status --short
```

إذا الـAPI شغال أثناء إعادة بناء C# وواجهت قفل ملفات على Windows، أوقفه أولاً باستخدام `Stop-ImportApi.ps1`. اختبارات `scripts/Test-*.mjs` المتقدمة قد تنشئ وتعدّل **بيانات QA محلية**؛ لا تشغّلها على قاعدة عميل أو بيانات مهمة بدون قراءة تفاصيل الاختبار وسكريبتات التنظيف.

### حدود مهمة

- الدليل خاص بتجهيز **بيئة Windows محلية**؛ النشر على Hostinger/Dokploy له دليل منفصل: [Release Runbook](../deploy/import/RELEASE-RUNBOOK.md).
- حسابات التطوير وكلمات المرور وبيانات PostgreSQL لا تُنقل إلى Production.
- لا تستخدم Root Compose للـLegacy Editor لتشغيل منتج الاستيراد الجديد.
- `.local/` و`frontend/.next/` و`node_modules/` مستثناة من Git؛ كل مطوّر بيعيد توليدها على جهازه.
- محتوى التوصيف الهندسي في [docs/README.md](README.md)، وأوامر GitHub العامة في [GITHUB_SETUP.md](../GITHUB_SETUP.md).

**مختصر التشغيل بعد أول تجهيز:** شغّل `Start-ImportApi.ps1` ثم `Start-Web.ps1`، وادخل على `/import/login` أو `/platform/login`.
