Here I want to write out the sudo code for a cat bond contract in solidity. | Fixed pricing contract 


Key variables: time period - 1. how long is the deal live for ( helps with coupon payouts), 
2.coupon, 
3. investors list struct ( addrsss, deposit amount )
4. tigger ( this will be the chainlink oracle for the tigger event)
5. Sponsor ( address and deposit amount, KYC data )


a specific wallet can initiate a cat bond contract by depositing their coupon representing the capital they are willing to pay for each dollar of coverage. 
*for now w'll just do 1 risk layer 


after other people can buy into the contract ---- the contract should save every address that has depositied as well as the amount they depositied ~ so we know how much they are owed via the coupon 

Business model: for the company we take a .5% fee on every deposit 

Monthly the contract will pay out the coupo to the addresses that have deposited 
- use the investor list pay out to each address their share. example 5% 1 year contract | investor witll $10,000 get's .4166% 
- a address in the list of investors should be able to call this coupon function and get their corresponding payout | they will have to pay their own gas fees. 
- must be able to track each coupon release so that their is 0 logic gap in when people can and cannot call this function and get their depoist 

Settlement: 
if a trigger happens and we accept the settlement all the investor funds will be paid to the sponsor wallet.
if not no transaction shall be sent to the company wallet for settlement and we'll continue periodically paying out to investors




Not sure if this has to be in the same contract or seperate but we want to continously monitor the trigger event and if it happens a message will be sent to a designated wallet ( COmpany wallet ) to settle the deal manually ( human in the loop element )


Restrictions: minimum buy in 25K USD. the deposited sponsor funds must be able to pay each deposit ( example $10000 %10 coupon | another person wants to invest 200K the contract should reject this deposit ) 
Only the companny wallet can settle the deal manually that 