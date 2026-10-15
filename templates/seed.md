# Template seed (DO NOT EDIT)

Source of truth for the original, version-1 text of every outreach template. These are stored exactly as written, typos, odd capitalisation and trailing spaces included. Real edits happen in the app as new template versions, never here.

Only three placeholders are ever substituted: `{{first_name}}`, `{{Company}}` and `{{COMPANY_UPPER}}` (the company name in uppercase). Anything else in a template is literal text. For example "ZOMATO and BLINKIT" and "Zomato and Blinkit" in Template 3 are literal on purpose.

File format (read by `src/lib/templates/seed-parser.ts`):
- Each template starts with a `## template_N` heading, then `- key: value` metadata lines.
- The body is the fenced block opened by a line reading ```text and closed by a line reading ```.
- The body is every line between those two fence lines, joined with a single line feed. There is no trailing newline, and nothing is trimmed.
- The file uses LF line endings and UTF-8 with no BOM. `.gitattributes` marks it `-text` so git never rewrites it.

## template_1

- name: Template 1
- default_category: other_relevant
- description: Not curated for quick-commerce companies; the "relevant to <Company>" line is the part that adapts.

```text
Hey {{first_name}}, I'm Afreen!

ik you prolly think who?
I'm Ml/Growth/Analyst, Worked on multiple Real life Problem.
I have worked on projects which is relevent to {{Company}}, 
like Training the models, evaluating the dataset, preprosessing Feature engineering and every analysis.

ik actions are louder than words so 
here are some of my Projects 
I'm working on these projects for 1 months, analyzing, inspecting, evaluating and understanding the pattern and everything.

Proof of work:
1. Delivery ETA prediction + Dark Store Analysis:
MAE: 3.01 min
RMSE: 3.76 min
R²: 0.840
Live link: https://food-delivery-eta-prediction.streamlit.app/

2. Demand Forecasting and Inventory Planning:
RMSLE: 0.825 → 0.5060
~38% reduction in recursive CV RMSLE
Live link: https://meal-demand-forecasting-and-inventory-planning.streamlit.app/

I’d really appreciate it if you could take a look when you get a chance. I’d also love to talk for 15–20 mins, any day available to your schedule.

so ATLEAST see the app and give a reply 
It take me months to finish>_<.

Hope you understand.
Portfolio: https://lab.afreen.tech/
Github: https://github.com/arshiafreen090

Afreen(Future {{Company}} Intern :P
```

## template_2

- name: Template 2
- default_category: quick_commerce
- description: Quick-commerce companies.

```text
Hey {{first_name}}, I'm Afreen! 

You prolly think who?
I'm Ml/Data Science/Analysts worked on 2 curated {{COMPANY_UPPER}} Project .
I chose to work in this cuz I'm carving myself to fit in {{COMPANY_UPPER}}.

ik actions are louder than words so 
here are some of my Projects 
I'm working on these projects for 1 months, analyzing, inspecting, evaluating and understanding the pattern and everything.

Proof of work:
1. Delivery ETA prediction + Dark Store Analysis:
MAE: 3.01 min
RMSE: 3.76 min
R²: 0.840
Live link: https://food-delivery-eta-prediction.streamlit.app/

2. Demand Forecasting and Inventory Planning:
RMSLE: 0.825 → 0.5060
~38% reduction in recursive CV RMSLE
Live link: https://meal-demand-forecasting-and-inventory-planning.streamlit.app/

I’d really appreciate it if you could take a look when you get a chance. I’d also love to talk for 15–20 mins, any day available to your schedule.

so ATLEAST see the app and give a reply 
It take me months to finish>_<.

Hope you understand.
Portfolio: https://lab.afreen.tech/
Github: https://github.com/arshiafreen090

Future {{Company}} Intern Afreen :P
```

## template_3

- name: Template 3
- default_category: food_delivery
- description: Food delivery companies. "ZOMATO and BLINKIT" and "Zomato and Blinkit" are literal on purpose (they name the datasets used), not placeholders.

```text
Hey {{first_name}}, I'm Afreen! 

You prolly think who?
I'm Ml/Data Science/Analysts worked on 2 curated ZOMATO and BLINKIT Project plus point i used Zomato and Blinkit datset to have proper prediction game :P.
I chose to work in this cuz I'm carving myself to fit in {{Company}}.

Proof of work:
1. Delivery ETA prediction + Dark Store Analysis:
MAE: 3.01 min
RMSE: 3.76 min
R²: 0.840
Live link: https://food-delivery-eta-prediction.streamlit.app/

2. Meal Demand Forecasting and Inventory Planning:
RMSLE: 0.825 → 0.5060
~38% reduction in recursive CV RMSLE
Live link: https://meal-demand-forecasting-and-inventory-planning.streamlit.app/

I’d really appreciate it if you could take a look when you get a chance. I’d also love to talk for 15–20 mins, any day available to your schedule.

so ATLEAST see the app and give a reply 
It take me months to finish>_<.

Hope you understand.
Portfolio: https://lab.afreen.tech/
Github: https://github.com/arshiafreen090

Future {{Company}} Intern Afreen :P
```

## template_4

- name: Template 4
- default_category: small_startup
- description: Small startup, not as intern.
- warning: Contains a line written for an anime company ("certified anime lover"). Edit that line before sending if this company is not anime-related. It is never auto-edited.

```text
Hey {{first_name}}, I'm Afreen!!

ik you prolly think who?
I'm Ml/Growth/Analyst, Worked on multiple Real life Problem.

Lately I'm following your work and {{Company}}, and
as a certified anime lover, love your work and company and wanted to contribute as an Analyst/Growth person.

I can analysis demand and forecasting 
I can handle website and system 
I can find the bottleneck for the logistics 
I can analysis the data to increase the demand 
etc etc and many more 

Proof of work:
1. Delivery ETA prediction + Dark Store Analysis:
R²: 0.840
Live link: https://food-delivery-eta-prediction.streamlit.app/

2. Demand Forecasting and Inventory Planning:
RMSLE: 0.825 → 0.5060
~38% reduction in recursive CV RMSLE
Live link: https://meal-demand-forecasting-and-inventory-planning.streamlit.app/

I'd love to jam how i can contribute and optimize the workflow. 
I’d also love to talk for 15–20 mins, any day available to your schedule.

Afreen :P
```
