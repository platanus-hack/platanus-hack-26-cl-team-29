# Giros e inicio de actividades en la consulta pública STC

Fecha: 2026-11-21 16:18
Autor: agente buscador-proveedores

## Contexto
Para categorizar proveedores de Mercado Público sin certificado se probó `consultarContribuyentePublico()` (`server/sii-portal/stc.ts`) con el RUT de un proveedor real.

## Hallazgo
- Responde en ~1 s sin sesión. Trae nombre, `fechaInicioActividades` como `DD-MM-AAAA` (no ISO) y la lista de giros con código CIIU4.CL de 6 dígitos, descripción en mayúsculas y fecha de inicio de cada giro, también `DD-MM-AAAA`.
- Un mayorista de alimentos trae varios giros (p. ej. 463012 carnes, 463019 abarrotes, 463020 bebidas, 469000 venta no especializada): por eso el giro se usa como señal secundaria y la categoría principal sale de lo que vende.
- Un RUT ficticio puede existir en el SII como otra empresa: los RUT de ejemplo no se consultan.

## Consecuencias
El buscador muestra la antigüedad tomando el año de `fechaInicioActividades`.
