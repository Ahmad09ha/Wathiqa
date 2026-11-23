# Wathiqa — Console-Only Structured Diagnostic Logs

## الهدف

إظهار مسار كل طلب Backend في **Console / Dokploy → Logs**، مع SQL الصادر عن EF Core وطلبات ShipsGo الخارجية، من دون أي جدول جديد بقاعدة البيانات أو كتابة ملف Logs من التطبيق.

السجلات الثلاثة مرتبطة بالحقل نفسه `TraceId`:

| اسم الحدث | ماذا يشرح؟ |
| --- | --- |
| `HTTP_REQUEST_COMPLETE` | HTTP Method، قالب الـ Endpoint (مثلاً `/api/tracking/{id:guid}/refresh`)، HTTP Status، مدة الطلب الكلية بالميلي ثانية، عدد SQL Commands، عدد الأخطاء ومدة SQL التراكمية |
| `SQL_COMMAND` | رقم تنفيذ مستقل `CommandId`، نوع SQL مثل `SELECT` أو `UPDATE`، النجاح أو الفشل، مدة التنفيذ، الاستعلام بعد إخفاء القيم، وعدد الصفوف المتأثرة عندما تعيده قاعدة البيانات. في حالة الفشل تُعرض أسماء أنواع الخطأ و`SQLSTATE` فقط |
| `OUTBOUND_HTTP_START` / `OUTBOUND_HTTP` | خروج طلب من Backend إلى ShipsGo V1.2/V2، HTTP Method، قالب مسار Endpoint، كود الاستجابة، الوقت والنتيجة. في أخطاء الشبكة `NETWORK_ERROR` واسم نوع الاستثناء فقط دون رسالته |

**مثال توضيحي، وليس بيانات حقيقية:**

```text
info: ... OUTBOUND_HTTP_START TraceId=0H... Provider=ShipsGoV2 Method=GET Endpoint=/v2/ocean/carriers
info: ... OUTBOUND_HTTP TraceId=0H... Provider=ShipsGoV2 Method=GET Endpoint=/v2/ocean/carriers StatusCode=200 DurationMs=135.2 Outcome=OK
info: ... SQL_COMMAND TraceId=0H... CommandId=... Operation=SELECT Outcome=OK DurationMs=3.4 AffectedRows=(null) Sql=SELECT ... FROM "SubscriptionTrackingUsages" WHERE "TenantId" = @__tenantId_0
info: ... HTTP_REQUEST_COMPLETE TraceId=0H... Method=POST Endpoint=/api/tracking/{id:guid}/refresh StatusCode=200 DurationMs=241.1 SqlCount=5 SqlFailed=0 SqlDurationMs=18.1
```

المهم: ابحث عن `TraceId` نفسه في سجلات الحاوية لتجد جميع الـ Queries والطلبات الخارجية المرتبطة بطلب مستخدم واحد. سجلات الـ Backend ليست سجلات JavaScript للمتصفح.

## التثبيت والأماكن

- Backend entrypoint: `backend/Wathiqa.ImportApi/Program.cs`.
- Middleware والعدادات: `backend/Wathiqa.ImportApi/ConsoleDiagnostics.cs`، من بداية دخول الطلب حتى الاستجابة بما فيها 401/403/404/500. تطبع قالب Route بدل القيم الفعلية في عنوان الطلب، وبدون Query String أو Cookies أو Bodies.
- EF Core `DbCommandInterceptor`: يلتقط Commands الناجحة والفاشلة للـ `Reader`، `NonQuery`، و`Scalar` في الشكلين sync/async، وكذلك استعلامات المصادقة وعمليات التعديل. لا يفعّل `EnableSensitiveDataLogging` إطلاقاً.
- ShipsGo provider HTTP logging: ضمن عميل V1.2 وV2 من خلال `ProviderHttpConsoleLog`. لا يسجل Header `X-Shipsgo-User-Token`، `authCode` القديم في Query String، Request/Response Bodies، أو رقم الشحنة الحقيقي ضمن المسار.
- التفعيل الافتراضي: `Diagnostics:ConsoleDetailed=true`.
- Dokploy / Compose optional: `WATHIQA_CONSOLE_LOGS_ENABLED=true`. إذا صار عدد السجلات ضخماً يمكن ضبطه على `false` ثم إعادة نشر حاوية API لإيقاف التفصيل (ويبقى logging الأساسي للمنصة). القيمة تمر إلى `Diagnostics__ConsoleDetailed` في الحاوية.

## الخصوصية وعدم التخزين

- **لا يوجد migration ولا أي DB write** لتخزين هذه الـ Logs. لا يتم إنشاء ملفات Logs أو إرسالها إلى خدمة خارجية من كود الـ Logging هذا.
- الـ SQL يُعرض فقط كـ **هيكل قابل للفهم**: اسم الجدول، الأعمدة، WHERE/JOIN، وأسماء باراميترات SQL من دون قيمها. تُحجب النصوص الحرفية والرقمية والتعليقات وPostgreSQL dollar-quoted literals. يمكن أن يتغيّر النص بعد الحجب فلا يصلح لإعادة التنفيذ مباشرةً.
- لا تسجل Passwords، API Tokens، CSRF/Cookies، طلبات ونتائج الوثائق/المدفوعات، Connection Strings، أو قيم SQL Parameters.
- Docker / Dokploy قد يحتفظان بـ stdout على قرص السيرفر بحسب إعداد **Docker logging driver** حتى لو أن التطبيق لا يكتب ملفات. لذلك قيّد الوصول إلى Docker Logs، وضبط سياسة retention عند إدارة السيرفر إذا لزم.
- نظام الـ Audit التجاري الموجود سابقاً في قاعدة بيانات Wathiqa **منفصل** عن الـ Console Logs الجديدة، ولا يتغير بسبب هذا التعديل.

## المراقبة

من Dokploy: `wathiqa-import → Logs → api`. ويمكن على السيرفر عند توفر ملف Compose وبيئته:

```bash
docker compose --env-file deploy/import/.env -f deploy/import/compose.yml logs -f --tail=200 api
```

عند تجربة اتصال ShipsGo بعد تعديل شبكة Docker، ابحث عن `OUTBOUND_HTTP` لمعرفة DNS/HTTP status. لا يُنشئ كود التسجيل أي طلبات شحن جديدة لمجرد تفعيل التسجيل، ولا تتغير آلية حساب Credits أو حماية التسجيلات المعلّقة.

## التحقق

```bash
dotnet build Wathiqa.slnx --configuration Release
dotnet run --project backend/Wathiqa.ShipsGoContractTests --configuration Release
```

اختبارات التتبع الإضافية تتحقق من حجب محتوى SQL، والأرقام، وتعليقات SQL وDollar-Quoted literals، ومن إخفاء Query String وHeaders وأرقام الشحنات في HTTP logs، ومن ظهور قالب Endpoint وعداد SQL الصحيح.

**الحدود:** استعلامات SQL المبنية من dynamic identifiers قد تظهر أسماء identifiers إذا ولّدها كود التطبيق؛ أدوات التوثيق تفترض أن identifiers موثوقة/ثابتة، وهي ليست بديلاً عن منع SQL injection. الـ Console لا يعرض عدد صفوف `SELECT`، لأن تسجيله سيتطلب قراءة البيانات الفعلية من `DbDataReader` وقد يغيّر سلوك التطبيق؛ يظهر العدد فقط لعمليات NonQuery التي تعيد AffectedRows.
