import json, sys, pathlib, urllib.request

def send_notification(title, body, source="自定义", event_id=None, kind="info"):
    config = json.loads((pathlib.Path(__file__).resolve().parent.parent / "config.json").read_text(encoding="utf-8"))
    api = config["localApi"]
    payload = dict(title=title, body=body, source=source, kind=kind)
    if event_id: payload["id"] = event_id
    req = urllib.request.Request("http://127.0.0.1:%s/api/push" % api["port"], data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json", "Authorization": "Bearer " + api["token"]}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)

if __name__ == "__main__":
    if len(sys.argv) < 3: raise SystemExit("参数：标题 正文 [来源] [事件ID] [kind]")
    print(send_notification(*sys.argv[1:]))
