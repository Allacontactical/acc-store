#!/usr/bin/env python3
"""ALLACON OS free pilot: zero-network handoff and validation. Python stdlib only."""
import argparse, json, pathlib, sys

PILOT = ["2456618880", "2456642570", "2456655823", "2456826097", "2457760590"]
NAMES = {
 "2456618880":"RedHead Tech Hoodie",
 "2456642570":"Huntech Micro Lite",
 "2456655823":"Prime Series Realtree",
 "2456826097":"Cabela's Canada",
 "2457760590":"RedHead Fleece Quarter-Zip",
}
SEO = """Ти SEO-редактор AllaconTactical. Мета: органічні переходи й продажі. Працюй ТІЛЬКИ з наданим описом продавця, нічого не вигадуй. Поверни JSON: product_id, title_ua (до 60 символів), primary_query, secondary_queries (до 5), seo_reason. Без аудиту матеріалів."""
SALES = """Ти редактор продажів AllaconTactical. Пиши українською преміально, стисло, без емодзі, з перевагами лише з вихідного опису продавця. Не вигадуй характеристики, наявність, ціну чи пов'язані товари. CTA: 'Отримати консультацію фахівця'. Поверни JSON: product_id, description_ua, cta, related_product_ids (лише з переданого каталогу)."""

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--input",required=True,help="JSON array of source products with id,title,description")
 p.add_argument("--out",default="allacon-os-output")
 a=p.parse_args()
 products=json.loads(pathlib.Path(a.input).read_text(encoding="utf-8"))
 if not isinstance(products,list): raise ValueError("Expected array")
 out=pathlib.Path(a.out); out.mkdir(parents=True,exist_ok=True)
 done=[]
 for item in products:
  pid=str(item.get("id",""))
  if pid not in PILOT: continue
  desc=str(item.get("description","")).strip()
  if not desc: continue
  src={"product_id":pid,"title":item.get("title") or NAMES[pid],"seller_description":desc}
  (out/f"{pid}-deepseek.txt").write_text(SEO+"\n\nДані:\n"+json.dumps(src,ensure_ascii=False,indent=2),encoding="utf-8")
  (out/f"{pid}-gemini.txt").write_text(SALES+"\n\nДані:\n"+json.dumps(src,ensure_ascii=False,indent=2),encoding="utf-8")
  done.append({"product_id":pid,"status":"awaiting_agent_outputs","source":src})
 (out/"review-queue.json").write_text(json.dumps(done,ensure_ascii=False,indent=2),encoding="utf-8")
 print(f"Prepared {len(done)} products; 0 API calls; 0 paid services; 0 publications.")
 if not done: sys.exit("No pilot products with seller descriptions found.")
if __name__=="__main__": main()
