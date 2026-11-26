/**
 * Zabbix 7 Webhook media type script for NextITOps.
 *
 * Zabbix media type parameters (name -> value):
 *   URL       -> https://your-nextitops.example.com/api/webhooks/zabbix/<secret>
 *   EventID   -> {EVENT.ID}
 *   EventName -> {EVENT.NAME}
 *   Severity  -> {EVENT.SEVERITY}
 *   Status    -> {EVENT.STATUS}
 *   Host      -> {HOST.HOST}
 *   HostIP    -> {HOST.IP}
 *   TriggerID -> {TRIGGER.ID}
 *   Tags      -> {EVENT.TAGSJSON}
 */
try {
  var params = JSON.parse(value);

  if (!params.URL) {
    throw 'NextITOps URL parameter is required';
  }

  var tags = [];
  if (params.Tags) {
    try {
      tags = JSON.parse(params.Tags);
    } catch (ignore) {
      tags = [];
    }
  }

  var payload = {
    event: {
      id: String(params.EventID || ''),
      name: String(params.EventName || 'Zabbix alert'),
      severity: String(params.Severity || 'Warning'),
      status: String(params.Status || 'PROBLEM'),
      tags: tags
    },
    host: {
      host: String(params.Host || ''),
      ip: String(params.HostIP || '')
    },
    trigger: {
      triggerid: String(params.TriggerID || '')
    }
  };

  var request = new HttpRequest();
  request.addHeader('Content-Type: application/json');
  var response = request.post(params.URL, JSON.stringify(payload));
  var status = request.getStatus();

  if (status !== 202) {
    throw 'NextITOps responded with HTTP ' + status + ': ' + response;
  }

  return 'NextITOps accepted: ' + response;
} catch (error) {
  throw 'NextITOps webhook failed: ' + error;
}
