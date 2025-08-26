import google.generativeai as genai
import os

# --- ضع مفتاح الـ API الخاص بك هنا ---
# تأكد من استبدال "YOUR_API_KEY" بالمفتاح الحقيقي
GOOGLE_API_KEY = "AIzaSyCPLd-KhlHsw-x64frcGssqFiy-rwaPWo4" 

print("--- بدء التشخيص ---")

try:
    # 1. طباعة إصدار المكتبة للتحقق من التحديث
    print(f"إصدار مكتبة google-generativeai المثبتة: {genai.__version__}")

    # 2. إعداد الـ API Key
    genai.configure(api_key=GOOGLE_API_KEY)
    print("تم إعداد مفتاح API بنجاح.")

    # 3. طباعة قائمة النماذج المتاحة لحسابك
    print("\n--- النماذج المتاحة لك ---")
    for model in genai.list_models():
        if 'generateContent' in model.supported_generation_methods:
            print(f"اسم النموذج: {model.name}")
    print("--------------------------\n")

    print("--- التشخيص انتهى بنجاح ---")

except Exception as e:
    print(f"\n!!! حدث خطأ أثناء التشخيص !!!")
    print(f"تفاصيل الخطأ: {e}")