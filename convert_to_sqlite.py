import re

with open('packages/db/prisma/schema.prisma', 'r') as f:
    content = f.read()

# Remove postgresqlExtensions and extensions
content = re.sub(r'previewFeatures\s*=\s*\[.*"postgresqlExtensions".*\]', 'previewFeatures = ["fullTextSearch"]', content)
content = re.sub(r'datasource db \{[\s\S]*?\}', 'datasource db {\n  provider = "sqlite"\n  url      = "file:./dev.db"\n}', content)

# Remove @db.Uuid, @db.Citext, @db.Decimal(...), @db.Date, @db.BigInt
content = content.replace(' @db.Uuid', '')
content = content.replace(' @db.Citext', '')
content = re.sub(r' @db\.Decimal\(\d+, \d+\)', '', content)
content = content.replace(' @db.Date', '')
content = content.replace(' @db.BigInt', '')

# SQLite doesn't support enums natively, but Prisma handles it. 
# However, we need to make sure we don't have any Postgres-specific extension usage.

with open('packages/db/prisma/schema.prisma', 'w') as f:
    f.write(content)
