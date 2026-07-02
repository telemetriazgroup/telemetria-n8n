#!/usr/bin/env python3
"""Genera workflow_ok.json con rama historical (día a día)."""
import json
from pathlib import Path

base = Path(__file__).resolve().parent.parent
cn = base / 'code-nodes'

def read(name):
    return (cn / name).read_text(encoding='utf-8')

PG = {'postgres': {'id': 'REEMPLAZAR', 'name': 'Postgres telemetria'}}
GMAIL = {'gmailOAuth2': {'id': 'REEMPLAZAR', 'name': 'Gmail account'}}

def code_node(id_, name, pos, js_file, each_item=False):
    params = {'jsCode': read(js_file)}
    if each_item:
        params['mode'] = 'runOnceForEachItem'
    return {
        'parameters': params,
        'id': id_,
        'name': name,
        'type': 'n8n-nodes-base.code',
        'typeVersion': 2,
        'position': pos,
    }

def pg_node(id_, name, pos, query, always_out=True):
    opts = {'alwaysOutputData': True} if always_out else {}
    return {
        'parameters': {'operation': 'executeQuery', 'query': query, 'options': opts},
        'id': id_,
        'name': name,
        'type': 'n8n-nodes-base.postgres',
        'typeVersion': 2.5,
        'position': pos,
        'credentials': PG,
    }

def if_node(id_, name, pos, left, right, op='equals'):
    return {
        'parameters': {
            'conditions': {
                'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict'},
                'conditions': [{
                    'id': 'c1',
                    'leftValue': left,
                    'rightValue': right,
                    'operator': {'type': 'string', 'operation': op},
                }],
                'combinator': 'and',
            },
            'options': {},
        },
        'id': id_,
        'name': name,
        'type': 'n8n-nodes-base.if',
        'typeVersion': 2.2,
        'position': pos,
    }

def if_bool(id_, name, pos, expr):
    return {
        'parameters': {
            'conditions': {
                'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose'},
                'conditions': [{
                    'id': 'c1',
                    'leftValue': expr,
                    'rightValue': True,
                    'operator': {'type': 'boolean', 'operation': 'true'},
                }],
                'combinator': 'and',
            },
            'options': {},
        },
        'id': id_,
        'name': name,
        'type': 'n8n-nodes-base.if',
        'typeVersion': 2.2,
        'position': pos,
    }

nodes = [
    {
        'parameters': {'rule': {'interval': [{'field': 'minutes', 'minutesInterval': 30}]}},
        'id': 'node-schedule', 'name': 'Programar revisión',
        'type': 'n8n-nodes-base.scheduleTrigger', 'typeVersion': 1.2, 'position': [-200, 480],
    },
    {
        'parameters': {},
        'id': 'node-manual-hist', 'name': 'Histórico manual',
        'type': 'n8n-nodes-base.manualTrigger', 'typeVersion': 1, 'position': [-200, 680],
    },
    {
        'parameters': {
            'httpMethod': 'POST',
            'path': 'historico-run',
            'responseMode': 'onReceived',
            'options': {},
        },
        'id': 'node-webhook-hist',
        'name': 'Webhook histórico',
        'type': 'n8n-nodes-base.webhook',
        'typeVersion': 2,
        'position': [-200, 880],
        'webhookId': 'telemetria-historico-run',
    },
    code_node('node-webhook-cfg', 'Config histórico API', [40, 880], '00c-webhook-config-historico.js'),
    {
        'parameters': {
            'assignments': {
                'assignments': [
                    {'id': 'c1', 'name': 'mode', 'value': 'incremental', 'type': 'string'},
                    {'id': 'c2', 'name': 'startDate', 'value': '', 'type': 'string'},
                    {'id': 'c3', 'name': 'endDate', 'value': '', 'type': 'string'},
                    {'id': 'c4', 'name': 'tzOffsetHours', 'value': -5, 'type': 'number'},
                    {'id': 'c5', 'name': 'receivedOnly', 'value': True, 'type': 'boolean'},
                    {'id': 'c6', 'name': 'monitorMailbox', 'value': 'telemetria@zgroup.com.pe', 'type': 'string'},
                    {'id': 'c7', 'name': 'keywordFilterEnabled', 'value': True, 'type': 'boolean'},
                    {'id': 'c8', 'name': 'requiredKeyword', 'value': 'telemetria', 'type': 'string'},
                    {'id': 'c9', 'name': 'keywords', 'value': '={{ ["Luis", "Eusebio"] }}', 'type': 'array'},
                    {'id': 'c10', 'name': 'skipKnownInDb', 'value': True, 'type': 'boolean'},
                    {'id': 'c11', 'name': 'telemetriaVariants',
                     'value': '={{ ["telemetria", "telemtria", "telemetrai", "ztrack", "api", "software", "plataforma"] }}', 'type': 'array'},
                    {'id': 'c12', 'name': 'matchExcerptRadius', 'value': 120, 'type': 'number'},
                ]
            }, 'options': {},
        },
        'id': 'node-config', 'name': 'Configuración',
        'type': 'n8n-nodes-base.set', 'typeVersion': 3.4, 'position': [40, 480],
    },
    {
        'parameters': {
            'assignments': {
                'assignments': [
                    {'id': 'h1', 'name': 'mode', 'value': 'historical', 'type': 'string'},
                    {'id': 'h2', 'name': 'startDate', 'value': '2025-12-01', 'type': 'string'},
                    {'id': 'h3', 'name': 'endDate', 'value': '2025-12-26', 'type': 'string'},
                    {'id': 'h4', 'name': 'tzOffsetHours', 'value': -5, 'type': 'number'},
                    {'id': 'h5', 'name': 'receivedOnly', 'value': True, 'type': 'boolean'},
                    {'id': 'h6', 'name': 'monitorMailbox', 'value': 'telemetria@zgroup.com.pe', 'type': 'string'},
                    {'id': 'h7', 'name': 'keywordFilterEnabled', 'value': True, 'type': 'boolean'},
                    {'id': 'h8', 'name': 'skipKnownInDb', 'value': True, 'type': 'boolean'},
                    {'id': 'h9', 'name': 'keywords', 'value': '={{ ["Luis", "Eusebio"] }}', 'type': 'array'},
                    {'id': 'h10', 'name': 'telemetriaVariants',
                     'value': '={{ ["telemetria", "telemtria", "telemetrai", "ztrack", "api", "software", "plataforma"] }}', 'type': 'array'},
                    {'id': 'h11', 'name': 'matchExcerptRadius', 'value': 120, 'type': 'number'},
                ]
            }, 'options': {},
        },
        'id': 'node-config-hist', 'name': 'Config histórico',
        'type': 'n8n-nodes-base.set', 'typeVersion': 3.4, 'position': [40, 680],
    },
    if_node('node-if-hist', '¿Modo histórico?', [260, 480],
            '={{ $json.mode }}', 'historical'),
    pg_node('node-pg-analyzed', 'Obtener días analizados', [480, 360],
            "={{ (() => { "
            "const c = (() => { "
            "for (const n of ['Config histórico API', 'Config histórico', 'Configuración']) { "
            "try { if ($(n).isExecuted) return $(n).first().json; } catch(e) {} "
            "} return $('Configuración').first().json; })(); "
            "const s = c.startDate; const e = c.endDate; "
            "return \"WITH done AS (SELECT analyzed_date FROM email_history_day WHERE status = 'completed' "
            "AND analyzed_date >= '\" + s + \"'::date AND analyzed_date <= '\" + e + \"'::date) "
            "SELECT analyzed_date::text AS analyzed_date FROM done "
            "UNION ALL SELECT NULL::text AS analyzed_date WHERE NOT EXISTS (SELECT 1 FROM done) "
            "ORDER BY analyzed_date NULLS FIRST\"; "
            "})() }}"),
    code_node('node-impulse-plan', 'Impulsar planificación', [600, 360], '09a-impulsar-planificacion.js'),
    code_node('node-plan-days', 'Planificar días pendientes', [820, 360], '09-planificar-dias-historicos.js'),
    if_bool('node-if-pending', '¿Hay días pendientes?', [1140, 360],
            '={{ !$json._noPendingDays }}'),
    pg_node('node-pg-last-review', 'Obtener última revisión', [480, 560],
            read('00-obtener-ultima-revision.sql').strip()),
    code_node('node-buildquery', 'Construir consulta Gmail', [1360, 480], '01-construir-consulta.js'),
    pg_node('node-pg-known', 'Obtener IDs en BD', [1580, 360],
            '={{ $json.knownIdsQuery }}'),
    {
        'parameters': {
            'method': 'GET',
            'url': 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
            'authentication': 'predefinedCredentialType',
            'nodeCredentialType': 'gmailOAuth2',
            'sendQuery': True,
            'queryParameters': {
                'parameters': [
                    {'name': 'q', 'value': '={{ $json.gmailQuery }}'},
                    {'name': 'maxResults', 'value': '500'},
                ]
            },
            'options': {},
        },
        'id': 'node-http-list', 'name': 'Listar IDs Gmail',
        'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2,
        'position': [1580, 600], 'credentials': GMAIL,
    },
    code_node('node-filter-new', 'Filtrar solo nuevos', [1800, 600], '05-filtrar-solo-nuevos.js'),
    if_bool('node-if-empty-hist', '¿Día vacío histórico?', [2020, 600],
            "={{ (() => { "
            "for (const n of ['Config histórico API', 'Config histórico', 'Configuración']) { "
            "try { "
            "if ($(n).isExecuted && $(n).first().json.mode === 'historical' && $json._empty === true) "
            "return true; "
            "} catch(e) {} "
            "} return false; "
            "})() }}"),
    if_bool('node-if-has-id', '¿Hay correos nuevos?', [2020, 780],
            '={{ !!$json.id }}'),
    code_node('node-skip-empty', 'Omitir si vacío', [2240, 780], '06-skip-si-vacio.js'),
    {
        'parameters': {
            'resource': 'message', 'operation': 'get',
            'messageId': '={{ $json.id }}', 'simple': False,
            'options': {'downloadAttachments': False},
        },
        'id': 'node-gmail', 'name': 'Leer Gmail',
        'type': 'n8n-nodes-base.gmail', 'typeVersion': 2.1,
        'position': [2460, 780], 'credentials': GMAIL,
    },
    code_node('node-normalize', 'Normalizar correo', [2680, 780], '02-normalizar.js'),
    code_node('node-filter-relevant', 'Filtrar recibidos relevantes', [2900, 780], '07-filtrar-recibidos-relevantes.js'),
    if_bool('node-if-close-day', '¿Cerrar día sin matches?', [3120, 780],
            '={{ $json._cerrarDiaHistorico === true }}'),
    code_node('node-prepare-trace', 'Preparar trazabilidad', [3340, 680], '04-preparar-trace.js'),
    {
        'parameters': {
            'operation': 'insert',
            'schema': {'__rl': True, 'mode': 'name', 'value': 'public'},
            'table': {'__rl': True, 'mode': 'name', 'value': 'email_trace'},
            'columns': {'mappingMode': 'autoMapInputData', 'value': {}, 'matchingColumns': ['message_id']},
            'options': {'skipOnConflict': True},
        },
        'id': 'node-insert-trace', 'name': 'Guardar trazabilidad',
        'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5,
        'position': [3340, 680], 'credentials': PG,
    },
    code_node('node-expand', 'Expandir adjuntos', [3120, 880], '03-expandir-adjuntos.js'),
    {
        'parameters': {
            'operation': 'insert',
            'schema': {'__rl': True, 'mode': 'name', 'value': 'public'},
            'table': {'__rl': True, 'mode': 'name', 'value': 'email_attachment_ref'},
            'columns': {'mappingMode': 'autoMapInputData', 'value': {},
                        'matchingColumns': ['message_id', 'attachment_id', 'filename']},
            'options': {'skipOnConflict': True},
        },
        'id': 'node-insert-attach', 'name': 'Guardar referencia adjuntos',
        'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.5,
        'position': [3340, 880], 'credentials': PG,
    },
    code_node('node-reg-day', 'Registrar día histórico', [3560, 480], '10-registrar-dia-historico.js'),
    pg_node('node-save-day', 'Guardar resumen día', [3780, 480],
            '={{ $json.upsertSql }}', always_out=True),
    # reset branch
    {'parameters': {}, 'id': 'node-reset-manual', 'name': 'Reiniciar hoy',
     'type': 'n8n-nodes-base.manualTrigger', 'typeVersion': 1, 'position': [-200, 80]},
    {'parameters': {'assignments': {'assignments': [
        {'id': 'r1', 'name': 'resetPassword', 'value': '', 'type': 'string'}]}, 'options': {}},
     'id': 'node-reset-config', 'name': 'Config reinicio',
     'type': 'n8n-nodes-base.set', 'typeVersion': 3.4, 'position': [20, 80]},
    code_node('node-validar-reset', 'Validar contraseña reset', [240, 80], '08-validar-reset-password.js'),
    pg_node('node-supersede', 'Supersede correos activos', [460, 80], read('00e-supersede-activos.sql').strip()),
]

connections = {
    'Programar revisión': {'main': [[{'node': 'Configuración', 'type': 'main', 'index': 0}]]},
    'Histórico manual': {'main': [[{'node': 'Config histórico', 'type': 'main', 'index': 0}]]},
    'Webhook histórico': {'main': [[{'node': 'Config histórico API', 'type': 'main', 'index': 0}]]},
    'Config histórico API': {'main': [[{'node': 'Obtener días analizados', 'type': 'main', 'index': 0}]]},
    'Config histórico': {'main': [[{'node': 'Obtener días analizados', 'type': 'main', 'index': 0}]]},
    'Reiniciar hoy': {'main': [[{'node': 'Config reinicio', 'type': 'main', 'index': 0}]]},
    'Config reinicio': {'main': [[{'node': 'Validar contraseña reset', 'type': 'main', 'index': 0}]]},
    'Validar contraseña reset': {'main': [[{'node': 'Supersede correos activos', 'type': 'main', 'index': 0}]]},
    'Supersede correos activos': {'main': [[{'node': 'Configuración', 'type': 'main', 'index': 0}]]},
    'Configuración': {'main': [[{'node': '¿Modo histórico?', 'type': 'main', 'index': 0}]]},
    '¿Modo histórico?': {'main': [
        [{'node': 'Obtener días analizados', 'type': 'main', 'index': 0}],
        [{'node': 'Obtener última revisión', 'type': 'main', 'index': 0}],
    ]},
    'Obtener días analizados': {'main': [[{'node': 'Impulsar planificación', 'type': 'main', 'index': 0}]]},
    'Impulsar planificación': {'main': [[{'node': 'Planificar días pendientes', 'type': 'main', 'index': 0}]]},
    'Planificar días pendientes': {'main': [[{'node': '¿Hay días pendientes?', 'type': 'main', 'index': 0}]]},
    '¿Hay días pendientes?': {'main': [
        [{'node': 'Construir consulta Gmail', 'type': 'main', 'index': 0}],
        [],
    ]},
    'Obtener última revisión': {'main': [[{'node': 'Construir consulta Gmail', 'type': 'main', 'index': 0}]]},
    'Construir consulta Gmail': {'main': [[
        {'node': 'Obtener IDs en BD', 'type': 'main', 'index': 0},
        {'node': 'Listar IDs Gmail', 'type': 'main', 'index': 0},
    ]]},
    'Obtener IDs en BD': {'main': [[]]},
    'Listar IDs Gmail': {'main': [[{'node': 'Filtrar solo nuevos', 'type': 'main', 'index': 0}]]},
    'Filtrar solo nuevos': {'main': [[{'node': '¿Día vacío histórico?', 'type': 'main', 'index': 0}]]},
    '¿Día vacío histórico?': {'main': [
        [{'node': 'Registrar día histórico', 'type': 'main', 'index': 0}],
        [{'node': '¿Hay correos nuevos?', 'type': 'main', 'index': 0}],
    ]},
    '¿Hay correos nuevos?': {'main': [
        [{'node': 'Omitir si vacío', 'type': 'main', 'index': 0}],
        [],
    ]},
    'Omitir si vacío': {'main': [[{'node': 'Leer Gmail', 'type': 'main', 'index': 0}]]},
    'Leer Gmail': {'main': [[{'node': 'Normalizar correo', 'type': 'main', 'index': 0}]]},
    'Normalizar correo': {'main': [[{'node': 'Filtrar recibidos relevantes', 'type': 'main', 'index': 0}]]},
    'Filtrar recibidos relevantes': {'main': [[{'node': '¿Cerrar día sin matches?', 'type': 'main', 'index': 0}]]},
    '¿Cerrar día sin matches?': {'main': [
        [{'node': 'Registrar día histórico', 'type': 'main', 'index': 0}],
        [
            {'node': 'Preparar trazabilidad', 'type': 'main', 'index': 0},
            {'node': 'Expandir adjuntos', 'type': 'main', 'index': 0},
        ],
    ]},
    'Preparar trazabilidad': {'main': [[{'node': 'Guardar trazabilidad', 'type': 'main', 'index': 0}]]},
    'Expandir adjuntos': {'main': [[{'node': 'Guardar referencia adjuntos', 'type': 'main', 'index': 0}]]},
    'Guardar referencia adjuntos': {'main': [[{'node': 'Registrar día histórico', 'type': 'main', 'index': 0}]]},
    'Guardar trazabilidad': {'main': [[{'node': 'Registrar día histórico', 'type': 'main', 'index': 0}]]},
    'Registrar día histórico': {'main': [[{'node': 'Guardar resumen día', 'type': 'main', 'index': 0}]]},
    'Guardar resumen día': {'main': [[{'node': 'Obtener días analizados', 'type': 'main', 'index': 0}]]},
}

wf = {
    'name': 'Telemetria - Trazabilidad de correos (OK)',
    'nodes': nodes,
    'connections': connections,
    'settings': {'executionOrder': 'v1'},
    'active': False,
    'pinData': {},
}

with open(base / 'workflow_ok.json', 'w', encoding='utf-8') as f:
    json.dump(wf, f, indent=2, ensure_ascii=False)
    f.write('\n')

print('workflow_ok.json built with', len(nodes), 'nodes')
