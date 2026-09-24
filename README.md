<img width="309" height="90" alt="powered-by-lunch-money-badge" src="https://github.com/user-attachments/assets/eff31e9e-8e34-4cc0-86b1-1cd9cd230dcf" />


Disclaimer: based on the great widget from @aryascripts, subsequently forked from @berndsalewski as well.

# Lunch Money Widget
<img width="806" height="374" alt="IMG_0017" src="https://github.com/user-attachments/assets/64b2806b-b767-458d-9b0a-a344b534caf4" />

An iOS Widget for Leftover Lunch Money status, along with a short list of unreviewed transactions, and an indicator when there are pending deleted transactions.

One of my favorite features from a previous budgeting app was the ability to get a true sense of what money I had left to spend or save by the end of the month. Lunch Money makes this easy to calculate, and even better, gives us the tools to pull the data from the [Lunch Money API](https://lunchmoney.dev/introduction). This data is key for how I budget, so I whipped something up to get me the figure I was after.

I also thought it would be helpful to see a list of unreviewed transactions, as those are generally the newest ones coming in. This information plus the Leftover tracker helps me keep on top of my budget in close to real-time. An additional helpful feature is that the widget can show the previous period or the current period - so I've set up a iOS Widget stack of one widget showing the previous month, and one showing the current month.

Additionally, when synced transactions have been deleted from an account and need a manual delete (or keep if the deletion was a mistake), a red "Deleted Transactions Pending!" label is shown.

Tapping the widget opens the Lunch Money web app in a Scriptable WebView (inside Scriptable — avoids app redirect to Safari) to the following locations, relative to the period selected (except in the case of pending deleted transactions):

* Home Screen Large/Medium
  * Inflow/Outflow/Leftover section opens the budget
  * Unreviewed Transactions list opens the list of transactions that are set to "unreviewed" (including pending transactions)
  * "Deleted Transactions Pending!" text opens any pending deleted transactions regardless of the selected period
  * Anywhere else opens the full list of transactions (including pending transactions)
* Home Screen Small
  * Any tap opens the budget
* Lock Screen Medium
  * Any tap opens the full list of transactions (including pending transactions)
* Lock Screen Small
  * Any tap opens the budget

## How to Use

1. Download [Scriptable](https://scriptable.app)
2. Add new script
3. Copy and paste the contents of [index.js](https://raw.githubusercontent.com/john-cabaj/leftover-lunch-money/refs/tags/v3/index.js) and save
4. Tap and hold on the script name, select rename, name the script "Leftover Lunch Money"

   NOTE: This is not required for functionality, but describes the script for ease of use
6. Run the script, this will pop up an alert box
7. Paste your [API key from Lunch Money](https://my.lunchmoney.app/developers)
8. The API key will be stored in Scriptable's on-device Keychain, and shouldn't need to be entered again
9. Add a new widget to the home screen
10. Select a widget size, all sizes are supported
11. Tap and hold the new widget, select "Edit Widget"
12. Select Leftover Lunch Money from the list and select options as you see fit ("previous" = previous period, "current" or otherwise = current period):
    
      <img width="400" height="400" alt="options" src="https://github.com/user-attachments/assets/2fca5093-1e4f-48e8-83f6-83ab746a94f6" />
  
12. Once options are set, tap on the home screen (not the widget options) to save the changes
13. Enjoy!

## Other images
### Home Screen Large
<img width="539" height="539" alt="IMG_0019" src="https://github.com/user-attachments/assets/4339ca45-377a-4c25-9bf8-43f965bcf83f" />

### Home Screen Small
<img width="253" height="253" alt="IMG_0018" src="https://github.com/user-attachments/assets/c49f39e2-c34e-4098-94b6-5d766d8bfce9" />

### Home Screen Medium
<img width="537" height="249" alt="IMG_0017" src="https://github.com/user-attachments/assets/92a38f9a-4983-4337-9c4f-09a0579b975c" />

### Lock Screen Medium
<img width="417" height="213" alt="IMG_0020" src="https://github.com/user-attachments/assets/f9ae8bf5-933b-40c3-8e1c-2fe1c521faa7" />

### Lock Screen Small
<img width="210" height="210" alt="IMG_0021" src="https://github.com/user-attachments/assets/207cc057-d542-41e8-8f96-cca6c6ea5f63" />

## Privacy
Cached data (unreviewed transactions, inflow/outflow/leftover information, pending deleted transactions) and diagnostics data are stored in Scriptable's Documents directory.
