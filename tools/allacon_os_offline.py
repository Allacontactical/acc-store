#!/usr/bin/env python3
"""ALLACON OS: free offline handoff + response validation. Never publishes."""
import argparse,json,pathlib
IDS={"2456618880":"RedHead Tech Hoodie","2456642570":"Huntech Micro Lite","2456655823":"Prime Series Realtree","2456826097":"Cabela's Canada","2457760590":"RedHead Fleece Quarter-Zip"}
SEO="SEO: тільки дані продавця; JSON product_id,title_ua,primary_query,secondary_queries. title_ua до 60 символів."
SALES="Продажі: тільки дані продавця; JSON product_id,description_ua,cta,related_product_ids. CTA: Отримати консультацію фахівця."
def save(p,x):p.write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding="utf8")
p=argparse.ArgumentParser();p.add_argument("command",choices=["prepare","review"]);p.add_argument("--input");p.add_argument("--out",default="allacon-os-output");a=p.parse_args()
out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
if a.command=="prepare":
 items=json.loads(pathlib.Path(a.input).read_text(encoding="utf8"));queue=[]
 for item in items:
  pid=str(item.get("id",""));description=str(item.get("description") or "").strip()
  if pid not in IDS or not description:continue
  src={"product_id":pid,"title":item.get("title") or IDS[pid],"description":description}
  save(out/f"{pid}-source.json",src)
  for agent,instruction in [("deepseek",SEO),("gemini",SALES)]:
   (out/f"{pid}-{agent}.txt").write_text(instruction+"\n"+json.dumps(src,ensure_ascii=False),encoding="utf8")
  queue.append({"product_id":pid,"status":"awaiting_responses"})
 save(out/"queue.json",queue);print("Prepared",len(queue),"products. No API charges or publishing.")
else:
 results=[]
 for pid in IDS:
  if not (out/f"{pid}-source.json").exists():continue
  record={"product_id":pid,"status":"awaiting_responses","errors":[]}
  try:
   seo=json.loads((out/f"{pid}-deepseek-response.json").read_text(encoding="utf8"))
   sales=json.loads((out/f"{pid}-gemini-response.json").read_text(encoding="utf8"))
   if str(seo.get("product_id"))!=pid or str(sales.get("product_id"))!=pid:record["errors"].append("ID mismatch")
   if not seo.get("title_ua") or len(seo["title_ua"])>60:record["errors"].append("Invalid title")
   if not seo.get("primary_query") or not sales.get("description_ua"):record["errors"].append("Missing SEO or sales text")
   if sales.get("cta")!="Отримати консультацію фахівця":record["errors"].append("Invalid CTA")
   if sales.get("related_product_ids"):record["errors"].append("Related IDs require catalog verification")
   record["status"]="blocked" if record["errors"] else "manual_fact_check_required"
   record["draft"]={"seo":seo,"sales":sales}
  except (OSError,ValueError) as e:record["errors"].append(str(e))
  results.append(record)
 save(out/"review.json",results);print("Reviewed",len(results),"products. Publication disabled.")
