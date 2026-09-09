---
name: sdd-pr
description: Crea la Pull Request después de aplicar y verificar un cambio. Usar en la fase 7 del workflow.
---

# SDD — PR & Review

## Qué hacer

Después de Apply (fase 5) y Verify (fase 6), creá la Pull Request.

### Creación del branch
- Nombre: `feat/<nombre>` o `fix/<nombre>` — lowercase, guiones, sin espacios
- Si ya estás en el branch del cambio, asegurate de que los commits estén limpios

### Antes de hacer push
1. Revisá que los commits sean **unidades coherentes** — no mezcles concerns
2. No debe haber commits "wip", "fix", "anda esto" — si los hay, squeasealos
3. Verificá que ningún archivo sensible esté incluido (`.env`, secrets, etc.)

### Push y PR
1. Hacé push: `git push -u origin feat/<nombre>`
2. Abrí la PR con título descriptivo y resumen de los cambios
3. En el cuerpo: enlistá qué archivos se tocaron y por qué

### Review
1. **NO mergees** — el usuario revisa y aprueba primero
2. Si el cambio es >400 líneas aprox, proponé partirlo en PRs encadenadas (una PR principal y sub-PRs más chicas)

### Post-merge
Pasá a la fase 8 (Archive).
