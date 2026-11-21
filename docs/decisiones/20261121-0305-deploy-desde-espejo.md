# Deploy desde un repo espejo sincronizado automáticamente

Fecha: 2026-11-21 03:05
Autor: Jorge Oehrens

## Contexto
Render solo puede conectarse a repos que pertenecen a la cuenta del usuario. El repo del proyecto pertenece a la organización `platanus-hack`, así que Render no puede deployar desde él.

## Decisión
Render deploya desde un repo espejo personal. Un GitHub Action en el espejo copia `main` de este repo cada ~5 minutos. Todo el trabajo ocurre en el repo de la organización; nadie necesita configurar el espejo en su máquina.

## Consecuencias
- Lo que entra a `main` llega a producción sin intervención manual, en algunos minutos.
- `main` tiene que estar siempre en estado deployable.
- Alternativa descartada: que cada integrante configure un segundo destino de push hacia el espejo. Requería coordinación y permisos individuales.
