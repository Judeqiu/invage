THE JOURNAL OF FINANCE • VOL. LXI, NO. 4 • AUGUST 2006

# The Disposition Effect and Underreaction to News

ANDREA FRAZZINI ∗

**ABSTRACT**

This paper tests whether the “disposition effect,” that is the tendency of investors to ride losses and realize gains, induces “underreaction” to news, leading to return predictability. I use data on mutual fund holdings to construct a new measure of reference purchasing prices for individual stocks, and I show that post-announcement price drift is most severe whenever capital gains and the news event have the same sign. The magnitude of the drift depends on the capital gains (losses) experienced by the stock holders on the event date. An event-driven strategy based on this effect yields monthly alphas of over 200 basis points.

IN RECENT YEARS, MOUNTING EVIDENCE CHALLENGES the traditional view that securities are rationally priced to reflect publicly available information. Specif- ically, an extensive body of empirical literature reports that stock prices appear to drift after major corporate news announcements. While positive news is generally met with price appreciation, prices subsequent to the announce- ment often show positive abnormal drift; similarly, negative news generates negative market reaction around the event date, but often tends to be followed by a negative drift. As a result, some event-driven equity strategies based on market impact appear to earn significant returns in the subsequent weeks or even months. 1

∗Graduate School of Business, University of Chicago. This paper is based on a portion of my the- sis at Yale University. A special thanks to Owen Lamont and Nick Barberis for invaluable discus- sions, encouragement, and for insightful comments. Thanks also to the referee, Robert Stambaugh (the editor), Bob Shiller, Will Goetzmann, Riccardo Puglisi, Sigridur Benediktsdottir, Antti Peta- jisto, Judy Chevalier, Richard Mendenhall, Langdon Wheeler, Myron Scholes, Kent Daniel, Jeremy Stein and Toby Moskowitz, and to seminar participants at Yale University, the University of North Carolina, the Chicago Quantitative Alliance, Numeric Investors, Oak Hill Platinum Partners, Ziff Brothers Investments, the University of Pennsylvania, Goldman Sachs Asset Management, the University of Chicago, Cornell University, the Massachusetts Institute of Technology, New York University, Stanford University, Fuller & Thaler Asset Management, Northwestern University, Harvard University, Columbia University, and the Eastern Finance Association Meetings. I grate- fully acknowledge financial support from the Yale International Center for Finance, the Whitebox Advisors Doctoral Fellowship, and the Chicago Quantitative Alliance 11th academic competition. All errors are of course solely mine. 1 Events of this type include earnings announcements (Mendenhall (1991), Abarbanell and Bernard (1992)), stock splits (Grinblatt, Masulis, and Sheridan (1984), Desai and Prem (1997), Ikenberry, Gaeme, and Stice (1996)), tender offer and open market repurchases (Lakonishok and Vermaelen (1990), Ikenberry, Lakonishok, and Vermaelen (1995)), analysts’ recommendations re- visions (Groth et al. (1979), Bjerring, Lakonishok, and Vermaellen (1983), Elton, Grueber, and Gueltekin (1984), Womack (1996)), SEOs (Lougran and Ritter (1995), Teoh, Welch, and Wong (1998)), public announcements of insider trades (Seyhun (1986, 1988)), headline news (Chan (2003)), and R&D expenses increase (Eberhart, Maxwell, and Siddique (2004)).

* * *

## 2018 TheJournal of Finance

Utility

-$20-$10 $0 Losses Gains

Do not sell

Sell and realize the loss

**Figure 1. Prospect theory, mental accounting, and the disposition effect: Realize a loss.**

Assume that an investor purchased one share at $50 and the price is now $40. Suppose that in the next month, the price could go either up $10 or down $10 (with equal probability). The investor must choose between selling the stock now and realizing a paper loss of $10, or keeping the stock in his portfolio. This figure shows the utility gain (loss) of the two alternatives.

The interpretation of this evidence is still highly controversial, as no unified rational or irrational explanation has won general acceptance. 2 Nevertheless, there are some promising theoretical developments. Recent work by Barberis, Huang, and Santos (2002), Barberis, Huang, and Thaler (2003), and Grinblatt and Han (2005) integrates psychological evidence on typical attitudes to risk into models of equilibrium prices. These papers suggest that preferences speci- fications based on prospect theory and mental accounting can play an important role in explaining asset pricing dynamics and the cross-section of stock returns. 3

A combination of prospect theory and mental accounting (PT-MA) tends to generate a “disposition effect,” that is, a tendency to sell securities that have gone up not down in value since purchase. For example, assume that an investor purchased one share at $50 and the price is now $40. Suppose that in the next month, the price could go either up $10 or down $10 (with equal probability). The investor must choose between selling the stock now and realizing a paper loss of $10, or keeping the stock in his portfolio, in which case he has 50–50 odds of losing $20 and breaking even. A risk-averse investor will sell the stock. An investor who is risk seeking on the loss domain, employing the purchase price as the base (or reference price) to compute gains and losses, will not sell the stock. This example is illustrated in Figure 1; the PT-MA investor prefers the chance of breaking even to the certain pain of experiencing a loss. On the other hand, assume that the investor purchased one share at $50 and the price is now $60, again with a 50–50 chance of going up or down by $10.

2 See, for example, Fama (1998). 3 See Kahneman and Tversky (1979), and Thaler (1985).

* * *

Figure 2. Prospect theory, mental accounting, and the disposition effect: Realize a gain. Assume that an investor purchased one share at $50 and the price is now $60. Suppose that in the next month the price could go either up $10 or down $10 (with equal probability). The investor must choose between selling the stock now and realizing a paper gain of $10, or keeping the stock in his portfolio. This figure shows the utility gain (loss) of the two alternatives.

Figure 2. Prospect theory, mental accounting, and the disposition effect: Realize a gain.
Assume that an investor purchased one share at $50 and the price is now $60. Suppose that in
the next month the price could go either up $10 or down $10 (with equal probability). The investor

Assume that an investor purchased one share at $50 and the price is now $60. Suppose that in
the next month the price could go either up $10 or down $10 (with equal probability). The investor
must choose between selling the stock now and realizing a paper gain of $10, or keeping the stock
in his portfolio. This figure shows the utility gain (loss) of the two alternatives.
In this case, a PT-MA investor will prefer the immediate realization of the $10
gain and he will sell the stock. This example is illustrated in Figure 2.
In this paper, I argue that the presence of a large subset of investors who
display the disposition effect can generate stock price “underreaction” to news
and, in turn, return predictability and post-announcement price drift. When
a stock experiences good news and increases in value relative to the purchase
price, these investors want to sell it to lock in the paper gain, which depresses
its price (assuming a downward-sloping demand curve). From that lower base,
subsequent returns will be higher. Therefore, good news tends to lead to high
future returns. Similarly, when bad news is released into the market and the

subsequent returns will be higher. Therefore, good news tends to lead to high
future returns. Similarly, when bad news is released into the market and the
stock price goes down in value relative to the purchase price, disposition investors are reluctant to sell, absent a premium. In this case, any trading will
occur at a temporarily inflated price, and from that higher base, subsequent
returns will be lower. Hence, bad news tends to be followed by a negative price
drift.
To test this hypothesis, I propose a way to compute the aggregate basis for
individual stocks using data on actual stock holdings for a large class of investors, namely, mutual funds. I use a database of mutual funds holdings to
construct a time series of reference prices for individual stocks. I use this measure to construct a test of stock price underreaction to public news generated

* * *

## 2020 TheJournal of Finance

To test for event-driven return predictability, I first sort stocks into different classes according to the degree to which capital gains are likely to induce a slug- gish response to corporate news. I then construct a long–short equity strategy. The central prediction is that exposure to a disposition proxy should forecast cross-sectional differences in subsequent returns of the test portfolios. To better understand how investors who tend to ride losses and lock in pa- per gains can generate underreaction to news, consider the following example. Stock XYZ is trading at $13 and its aggregate cost basis is equal to $16; that is, most of the current holders acquired their shares at a price around $16, and the stock is currently trading at a capital loss. At date t, bad news reveals a consensus valuation of only $11. In the absence of frictions, the stock price should promptly adjust to $11. However, if holders are reluctant to realize the paper loss, that is, they restrict the available supply, and if demand functions are not perfectly elastic, the stock price will only fall to a point between $13 and $11. Thus, trading initially takes place at a temporarily inflated price, as current holders are willing to sell only at a premium, but from this higher base subsequent returns tend to be lower, ultimately generating a negative post-event drift. Now consider the same initial scenario, but let the initial aggregate cost basis be equal to $5, so that the stock is initially trading at a large capital gain. When the bad news is revealed, no friction rations the supply of the stock since most of the current holders are engaged in active selling to lock in their paper gains. Indeed, in this alternative scenario, the active selling helps the market to promptly incorporate the bad news, and thus the stock price should speedily drop to the new fundamental value. The reluctance to unload an asset that is trading at a capital loss hampers price discovery when negative news hits such a security; this results in post- event drift. Given that disposition investors ration the stock’s supply, bad news travels slowly across assets trading at large capital losses; this generates (neg- ative) post-event return predictability. Since disposition investors are more likely to realize gains than losses, a sim- ilar argument can be made for good news stocks. When most of the current holders are trading at large paper gains, their active selling tends to create excess supply, which leads to a lower price impact, and thus generates under- reaction to good news. If the stock is trading at a capital loss, the lower relative supply will generate a relatively higher price, and help the price adjustment to the new higher level. Good news travels slowly across assets trading at large capital gains, which generates (positive) post-event return predictability. This hypothetical example is illustrated in Figures 3 and 4, which report the impact of positive and negative news on stocks with unrealized gains and losses. The new result is that once one sorts event stocks using the capital gains measure, post-event predictability is indeed most severe where the disposition effect predicts the largest underreaction. Post-event drift is larger when news and capital gains have the same sign, and its magnitude is directly related to the amount of unrealized gains (losses) experienced by the stock holders on the event date.

* * *

_The Disposition Effect and Underreaction to News_ 2021

**Figure 3. An example of stock price response to negative news. This figure shows an**

example of a stock price response to negative news. The initial stock price is $13. At date 0, public news reveals a fundamental value of $11.

**Figure 4. An example of stock price response to positive news. This figure shows an exam-**

ple of a stock price response to positive news. The initial stock price is $11. At date 0, public news reveals a fundamental value of $13.

I also document the extent of the disposition effect among mutual fund man- agers and show that it adversely affects returns. Loser funds tend to be as dis- position prone as retail investors. The results confirm the intuition in Wermers (2003): Managers of underperforming funds appear reluctant to close their los- ing positions. Conversely, successful managers realize losses at higher rates than gains. The rest of the article is organized as follows. Section I gives a brief intro- duction to the disposition effect. Section II defines the central variable, the capital gains overhang. I also document the extent of the disposition effect among fund managers. In Section III, I describe the hypothesis. In Section IV,

* * *

## 2022 TheJournal of Finance

I report abnormal returns for the main test assets. Section V reports returns net of trading costs. Section VI concludes.

## I. The Disposition Effect

The disposition effect, introduced into the finance literature by Shefrin and Statman (1985), refers to the tendency of investors to ride losses and realize gains. This runs counter to sound tax planning. With the availability of account- level transaction data, the disposition effect has become a widely documented empirical regularity. Indeed, subsequent to the well-known paper by Odean (1998), several studies find that investors are reluctant to unload assets at a loss relative to the price at which they were purchased. The available evidence shows that although greater investor sophistication is associated with less susceptibility to the disposition effect, professional traders are far from immune to it. 4 Locke and Mann (2000) analyze the trading behavior of professional futures traders and find that while all traders hold losers longer than winners, the least successful traders hold losers the longest, while the most successful traders hold losers for the shortest time. Coval and Shumway (2000) report evidence of loss aversion among professional market makers at the Chicago Board of Trade, with the most compelling evidence concentrated in morning loser traders. Shapira and Venezia (2001) find evidence of the dispo- sition effect among professional investors in Israel, while results in Wermers (2003) show that managers of underperforming funds appear reluctant to sell their losing stocks, which is consistent with their being disposition prone.

## II. The Capital Gains Overhang

To construct a test of return predictability induced by the disposition effect, one must construct a measure of unrealized capital gains. Here, I use the time series of net purchases by mutual fund managers and their cost basis in a particular stock to compute a weighted average reference price. This measure is central to the empirical analysis in this paper since it allows one to summarize the dollar gains and losses experienced by the stock holders on a given date. Previous research focuses exclusively on price momentum and on a measure of the cost basis based on trading volume. 5 I devise a measure of the cost basis based on portfolio holdings, and I analyze the transmission of information when firm-specific information is released in the form of public news. I compute the reference price as

∑ _t_ _RPt_ = φ −1 _Vt,t−nPt−n_, (1) _n=0_

4 See Odean (1999), Barber and Odean (2000, 2001, 2002), Grinblatt and Keloharju (2001), Brown et al. (2002), and Dhar and Zhou (2002). 5 See Ferris, Haugen, and Makhija (1998), and Grinblatt and Han (2005).

* * *

_The Disposition Effect and Underreaction to News_ 2023

where V _t,t−n_ is the number of shares purchased at date t − n that are still held by the original purchasers at date ∑ _t, φ is a normalizing constant such that_ φ = _tn=0_ _Vt,t−n_, and P _t_ is the stock price at the end of month t. When a stock is purchased several times, and partially sold at different dates, I assume that investors use the purchase price as the base for computing gains and losses. When they trade, I assume that they use a cost-based mental ac- counting method (FIFO-first in, first out) to associate a quantity of shares in their portfolio to the corresponding reference price. 6

For example, assume that an investor purchases 100 shares at date 0 for _P0_ = $20 and an additional 100 shares at date 1 for P1 = 23.3, and subsequently sells 120 shares at date 2 for P2 = 22. Of the 120 shares sold, 100 units are assumed to be drawn from the shares acquired at date 0, which realize a gain, while the remaining 20 shares are sold at a loss. The total mental gain/loss will be (22 − 20) ∗ 100 + (22 − 23.3) ∗ 20 and the “mental book” at the end of period 2 will be given by V2,0= 0 and V2,1= 80. The capital gains overhang is defined as the percentage deviation of the aggregate cost basis from the current price

_Pt_ − RP _t_ _gt_ =. (2) _Pt_

Capital gains are meant to be the best estimate of the stock’s cost basis to the representative investor. The advantage of using holdings relies on the possibility of unambiguously identifying the fraction of shares purchased at a previous date that is still held by the original purchasers at the current date, thus taking into account shareholder heterogeneity in the anchor points. In the empirical analysis, I use mutual funds’ common stock holdings to compute capital gains and losses for individual stocks. While this assumes that mutual fund managers are a representative sample of the cross-section of share- holders, the approach is general and can be applied whenever holdings data are available for individual stocks. 7

_A. Data Description_ I obtain the data from several sources. Stock returns and accounting data between January 1980 and December 2002 are obtained from the CRSP/COMPUSTAT merged database. Quotes and trades are obtained from the New York Stock Exchange Trades and Quotations (TAQ) database; the TAQ 6 Using reference prices constructed employing LIFO, HIFO, the last trading price, the last buying price, or averages of past buying and selling prices does not alter any of the main results. 7 Clearly, we would like to use holdings of all the shareholders at a particular date, including retail investors. I repeat the analysis combining the mutual fund data (1980–2002) with individ- ual investors’ holdings from a nationwide discount brokerage house (1991–1996). The results are unchanged as the size of mutual funds’ common stocks holdings tends to swamp the fraction of shares outstanding owned by retail investors. Since I only have access to retail investors’ holdings for a limited period of 5 years and they do not generate a noticeable difference in the analysis, I present results obtained using mutual fund holdings only.

* * *

## 2024 TheJournal of Finance

data cover the period 1993 to 2002. Analysts’ stock recommendations are taken from the Institutional Brokers Estimates System (I/B/E/S); the data cover the period 1993 to 2002. Mutual fund holdings from January 1980 to December 2002 are obtained from the Thomson Financial CDA/Spectrum Mutual Funds database, which includes all registered mutual funds filing with the SEC plus 3,000 global funds. The data show holdings of individual funds collected via fund prospectuses and SEC N30D filings. 8

The statutory requirement for reporting holdings is semiannual. However, about 60% of the funds file quarterly reports. The data include a report date (RDATE), which is the calendar day at which a snapshot of the portfolio is recorded, and a file date (FDATE), which is a vintage date assigned by Thomson. Neither of the two dates corresponds to the actual filing date with the SEC. Thomson always assigns file dates to the corresponding quarter-ends of the filings. Although reports may be made on any day, the last day of the quarter is the most common report day. In some cases, the report date is as much as 6 months prior to the file date, because fund managers have discretion about when to take their portfolio’s snapshot, which can be filed at a subsequent date. A typical fund-quarter-stock observation is as follows: as of March 30th, 1998, Fidelity Magellan owned 20,000 shares of IBM. Holdings are adjusted for stock splits and are assumed to be public information with a 30-day lag from the file date. 9 Holdings are merged with CRSP data and filtered to eliminate potential anomalies that are probably due to misreporting or errors in data collecting. Holdings are set to missing whenever

1. the number of shares in a fund portfolio exceeds the total amount of shares outstanding at a particular date;
2. the value of the fund’s holding of a particular stock on a particular date is larger than the total asset value of the fund reported by CDA;
3. the asset has zero shares outstanding;
4. the total asset value of the fund reported by Thomson differs from the implied CRSP value by more than 100%. After these filters are applied, the data contain end-of-quarter stock holdings
   for about 29,000 mutual funds between January 1980 and December 2003. The stock price at the report date is used as a proxy for the buying or selling price. Clearly, this is a noisy measure, since the actual transaction price is generally different from the price at the report date. Nevertheless, to the extent that stock prices are equally likely to increase or decrease after being purchased or sold

8 Holdings are identified by CUSIP; they constitute most of the equities, but are not necessarily the entire equity holdings of the manager or fund. The potential exclusions include small holdings (typically under 10,000 shares or $200,000), cases in which there may be confidentiality issues, reported holdings that cannot be matched to a master security file, and cases in which two or more managers share control (since the SEC requires only one manager in such a case to include the holdings information in their report). 9 Currently, filings appear on the SEC EDGAR system on the next business day following a filing; however, information lags were probably longer at the beginning of the sample period.

* * *

Table I

The Capital Gains Overhang, Summary Statistics

The Disposition Effect and Underreaction to News 2025
Table I
The Capital Gains Overhang, Summary Statistics
This table reports summary statistics for the capital gains overhang. The capital gains overhang
is defined as the percentage deviation of the aggregate reference price from the current price
∑tn=0
g = (P − RP)/P. The reference price is defined as RP = φ−1V P, where V is the
t t t t t t,t−n t−n t,t−n
number of shares at date t that are still held by the original t − n purchasers, φ is a normalizing
constant, and P is the stock price at the end of month t. Investors are assumed to use a FIFO

g\_{t}=(P\_{t}-R P\_{t})/P\_{t}

\\begin{array}{r}{R P\_{t}=\\phi^{-1}\\sum\_{n=0}^{t}V\_{t,t-n}P\_{t-n}}\\end{array}

\\phi

P\_{t}

|  | Mean |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Year | VW | EW | Median | St.Dev. | Skew | P20 | P80 | % Stocks |
| 1985 | 0.08 | -0.08 | 0.01 | 0.42 | -2.55 | -0.26 | 0.18 | 64.5 |
| 1990 | 0.03 | -0.27 | -0.11 | 0.55 | -1.99 | -0.54 | 0.10 | 62.2 |
| 1995 | 0.05 | -0.07 | 0.03 | 0.44 | -2.61 | -0.24 | 0.20 | 83.6 |
| 2000 | -0.14 | -0.33 | -0.14 | 0.67 | -1.54 | -0.72 | 0.16 | 73.8 |
| 1980-2002 | 0.03 | -0.15 | -0.01 | 0.52 | -2.30 | -0.36 | 0.18 | 72.7 |

B. Cross-Sectional Determinants of the Capital Gains Overhang

by a mutual fund, I can see no reason to expect this measure to bias the results
one way or the other.

B. Cross-Sectional Determinants of the Capital Gains Overhang
Table I provides summary statistics of the capital gains overhang. In terms
of market capitalization, on average 84.4% of CRSP stocks have valid capital

riding gains rather than realizing them, or reflecting liquidity issues.
In model 2, I add firm turnover in the past year (TURN) and an interaction
10
term between turnover and returns as a control. The results show that con-

* * *

Table II

2026 TheJournal of Finance
Table II
The Capital Gains Overhang, Fama–MacBeth Regressions 1980–2002
This table reports coefficients from Fama–MacBeth regressions of the capital gains overhang on
a set of firm- and fund-specific regressors. R−12,1is the prior-year stock return, R−36,−13is the
previous 2-year return, log (mv−1)isthe log of market capitalization at the end of the previous
month, TURN is the average turnover in the previous 12 months, MF OWN is the percentage of
shares outstanding owned by mutual funds, and HOLD RET is the average return in the previous

R\_{-12,1}

R\_{-36,-13}

\\log(m v\_{-1})

R^{2}

\\bar{R}^{2}

| Model No. Dependent Variable | 1 Capital Gains | 2 Capital Gains | 3 Capital Gains | 4 Abs(Capital Gains) |
| --- | --- | --- | --- | --- |
| $R\_{-12,-1}$ | 0.396(10.87) | 0.553(15.29) | 0.557(15.25) | 0.273(5.71) |
| $R\_{-36,-13}$ | 0.044(4.27) | 0.068(6.81) | 0.073(7.90) | 0.012(2.89) |
| $\\log(mv\_{-1})$ | 0.064(13.91) | 0.071(13.44) | 0.069(17.07) | -0.072(-14.96) |
| TURN |  | -0.110(-15.80) | -0.127(-12.68) | 0.106(8.86) |
| NASD\*TURN |  | 0.086(3.87) | 0.073(7.58) | -0.062(-7.22) |
| $R\_{-12,1}\*TURN$ |  | -0.124(-11.40) | -0.134(-10.82) | -0.099(-5.35) |
| MF\_OWN |  |  | 0.452(10.67) | -0.290(-8.87) |
| HOLD\_RET |  |  | 0.424(8.14) | -0.474(-7.88) |
| $\\bar{R}^{2}$ | 0.25 | 0.28 | 0.30 | 0.15 |

\\log(m v\_{-1})

R\_{-12,1}\*\\mathrm{T U R N}

\\bar{R}^{2}

HOLD RET 0.424 −0.474
(8.14) (−7.88)
R¯20.25 0.28 0.30 0.15
In model 3, I add to the regressors the percentage of shares owned by mutual
funds (MF HOLD)aswell as the average return in the previous year of all the
funds holding the stocks (HOLD RET). If losing funds are reluctant to realize

funds holding the stocks (HOLD RET). If losing funds are reluctant to realize
losses, we would expect stocks with a low HOLD RET to be trading at a loss. The
results show that stocks mostly held by losing (winning) funds display larger
losses (gains). High fund ownership stocks tend to trade at a gain, probably
reflecting the fact that the average manager is less disposition prone compared
to retail investors.
Finally, I regress the absolute value of capital gains on the absolute value

* * *

Table III

Proportion of Gains Realized to the Aggregate Proportion of Losses Realized, Mutual Funds (1980-2002)

The Disposition Effect and Underreaction to News 2027
Table III
Proportion of Gains Realized to the Aggregate Proportion of Losses
Realized, Mutual Funds (1980–2002)
This table compares the aggregate proportion of gains realized (PGR) to the aggregate proportion
of losses realized (PLR). PGR (# of shares) is the number of realized gains divided by the number
of realized gains plus the number of paper (unrealized) gains. PLR (# of shares) is the number
of realized losses divided by the number of realized losses plus the number of paper (unrealized)
losses. PGR ($ value) is the dollar value of realized gains divided by the dollar value of realized

|  | Fund Return in the Previous Year(Quintiles) |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
|  | 1(Low) | 2 | 3 | 4 | 5(High) | All |
| #of shares |  |  |  |  |  |  |
| PLR | 0.112 | 0.122 | 0.137 | 0.158 | 0.169 | 0.145 |
| PGR | 0.193 | 0.182 | 0.188 | 0.179 | 0.198 | 0.176 |
| PGR-PLR | 0.081 | 0.060 | 0.051 | 0.021 | 0.029 | 0.031 |
| t-stat | (24.0) | (25.5) | (23.0) | (17.0) | (10.0) | (43.6) |
| $Value |  |  |  |  |  |  |
| PLR | 0.120 | 0.138 | 0.150 | 0.157 | 0.154 | 0.149 |
| PGR | 0.183 | 0.179 | 0.192 | 0.188 | 0.164 | 0.172 |
| PGR-PLR | 0.063 | 0.041 | 0.042 | 0.031 | 0.010 | 0.023 |
| t-stat | (19.0) | (22.5) | (21.0) | (16.0) | (9.0) | (33.6) |

PLR 0.120 0.138 0.150 0.157 0.154 0.149
PGR 0.183 0.179 0.192 0.188 0.164 0.172
PGR − PLR 0.063 0.041 0.042 0.031 0.010 0.023
t-stat (19.0) (22.5) (21.0) (16.0) (9.0) (33.6)

positive, probably reflecting nonlinearities not captured by the linear specification. Finally, high momentum stocks tend to have large capital gains of either
sign.
C. The Disposition Effect in Mutual Fund Managers

C. The Disposition Effect in Mutual Fund Managers
Table III compares the aggregate proportion of gains realized (PGR)tothe
aggregate proportion of losses realized (PLR) for all the 29,812 mutual funds in
the database, where PGR is realized gains divided by the sum of realized gains
and paper (unrealized) gains, and PLR is realized losses divided by realized
losses plus paper (unrealized) losses.
Each quarter a sale takes place between two report dates in a mutual fund
portfolio, the current stock price is compared to the purchase price to determine

* * *

## 2028 TheJournal of Finance

sample and across the performance-based quintiles. The t-statistics test the null hypothesis that the difference in proportions is equal to zero. What emerges from Table III is a statistically strong (t-statistic = 44) ten- dency for mutual fund managers to sell a higher proportion of their winners than their losers. The magnitude of the aggregate difference (PGR − PLR)is around 3%, which is smaller than the average 5% reported by Odean (1998) for retail investors, but still of the same order of magnitude. Computing PGR and _PLR on a dollar basis delivers similar results._ What is striking is the amount of variation that can be observed across the performance-based quintiles. Loser funds show signs of a disposition effect, with magnitudes comparable to retail investors: loser funds are 1.7 times more likely to realize a paper gain than a paper loss, an 8% (t-statistic = 25.5) difference between PGR and PLR. This result confirms the evidence in Wermers (2003) that managers of underperforming funds appear reluctant to sell their losing stocks.

## III. Underreaction to Corporate News

I describe the main underreaction hypothesis and design a related invest- ment rule to construct the test assets. The conjecture is that in the presence of disposition-prone investors, stock prices underreact to a specific set of news, and thereby generate post-event drift.

HYPOTHESIS UR (UNDERREACTION): When most of the current hold- ers are facing a capital loss, stock prices underreact to negative news and in turn generate a negative post-announcement price drift. When most of the current holders are facing a capital gain, stock prices underreact to positive news and in turn generate a positive post-announcement price drift. Moreover, holding the news constant, the capital gains overhang forecasts post-event returns.

An interaction between the news content and capital gains generates return predictability. The example in the Introduction reveals the intuition behind this hypothesis: trading (or reluctance to trade) by disposition investors tends to hamper price discovery. Positive (negative) news travels slowly in stocks with large capital gains (losses) as disposition traders tend to dampen the transmis- sion of information, thereby generating return continuation. Hypothesis UR implies that a long–short strategy, in which a long position in good news stocks is offset by a short position in negative news stocks, should yield higher returns, the higher the spread in the capital gains overhang be- tween the long and the short sides. Since stocks with large gains underreact more to good news and stocks with large losses underreact more to bad news, the difference in capital gains between the two positions of a long–short news strategy forecasts returns. I refer to the maximum profits strategy as the overhang spread:Aportfolio that is long good news stocks with the largest paper gains, and short bad news stocks with the largest paper losses has the largest capital gains spread between

* * *

The Disposition Effect and Underreaction to News 2029

The Disposition Effect and Underreaction to News 2029
the long and short sides. Similarly, I call the opposite extreme portfolio the
negative overhang spread:Aportfolio that is long good news stocks with the
largest capital losses and short bad news stocks with the largest capital gains
has the minimum (negative) gains spread between the long and short sides.
I use an investment rule that exploits the post-earnings announcement drift.
Labeled by Fama (1998) as “above suspicion,” the inability of stock prices to
speedily impound earnings information is probably the most compelling evidence of underreaction in equity markets. An extensive literature, dating back

speedily impound earnings information is probably the most compelling evidence of underreaction in equity markets. An extensive literature, dating back
to Ball and Brown (1968), suggests that investors underreact to the information content of earnings, and thereby generate return continuation, otherwise
11
known as the post-earnings announcement drift anomaly (hereafter PEAD).
Jegadeesh, Chan, and Lakonishok (1996) analyze the profitability of rolling
investment strategies based on the PEAD.
I use a rolling portfolio approach, following Jegadeesh and Titman (1993)
and Fama (1998). The resulting overlapping returns can be interpreted as the
returns of a trading strategy that in any given month t holds a series of portfolios
selected in the current month as well as in the previous k months, where k is
the holding period. At the beginning of each month, an independent sort is

the holding period. At the beginning of each month, an independent sort is
used to rank stocks on the basis of their most recent earnings surprises and the
capital gains overhang at the end of the previous month. The ranked stocks are
assigned to one of 25 quintile portfolios. All stocks are equally weighted within
a given portfolio, and the overlapping portfolios are rebalanced every calendar
12
month to maintain equal weights.

12
month to maintain equal weights.
Earnings surprises are measured using the market model cumulative abnor-
13
mal returns around the most recent earnings announcement date. This is a
fairly clean measure of news since it does not rely on assumptions regarding
the market expectation for earnings. A return-driven news sort is appropriate
because it closely mimics the underreaction hypothesis at hand.
Acaveat that arises when sorting stocks using capital gains is that it is likely

Acaveat that arises when sorting stocks using capital gains is that it is likely
for winning (losing) stocks to exhibit large gains (losses). Ideally, we would like
the subsamples to contain stocks with similar characteristics, but a wide spread
in capital gains. Therefore, I sort stocks using both the capital gains overhang

and a residual overhang. The residuals are constructed from cross-sectional
14
regressions of gains on past returns, size, and volume.
The time series of returns of the rolling portfolios tracks the calendar month
performance of a post-event strategy that is based entirely on observables. Such
an investment rule should earn zero abnormal returns in an efficient market.

an investment rule should earn zero abnormal returns in an efficient market.

11See Joy, Litzenberger, and McEnally (1977); Rendleman, Jones, and Latane (1982); Foster,
Olsen, and Shevlin (1984); Bernard and Thomas (1989, 1990); Affleck-Graves and Mendenhall
(1992); Ball and Bartov (1996); and more recently, Collins and Hribar (2000) and Tarun and

Olsen, and Shevlin (1984); Bernard and Thomas (1989, 1990); Affleck-Graves and Mendenhall
(1992); Ball and Bartov (1996); and more recently, Collins and Hribar (2000) and Tarun and

* * *

I compute abnormal returns from a time-series regression of the portfolio excess returns on contemporaneous Fama and French (1993) factors in calendar time. $ ^{15} $

2030 TheJournal of Finance
I compute abnormal returns from a time-series regression of the portfolio excess returns on contemporaneous Fama and French (1993) factors in calendar
15
time.
Positive abnormal returns following positive news indicate the presence of

time.
Positive abnormal returns following positive news indicate the presence of
post-event drift, consistent with underreaction or a sluggish response to news.
The opposite is true for negative news. Under Hypothesis UR, the overhang
spread consistently earns higher returns than the negative overhang spread.
Ceteris paribus, the wider the spread in capital gains between the long and the
short sides, the larger the subsequent alpha.
Note that the disposition effect makes a scenario-specific prediction about

the sign of the underreaction pattern. In particular, the underreaction is more
severe whenever capital gains and the event have the same sign. Stocks for

which most current holders are experiencing large paper losses severely underreact to negative news, as opposed to negative news stocks that are trading at
large gains. The opposite is true for positive news stocks.

large gains. The opposite is true for positive news stocks.
IV. Results
The focus of the analysis is on short-term underreaction. Since earnings news
is released on a quarterly basis, I use a 3-month strategy as the benchmark
portfolio when presenting the results.
I begin by reporting returns of the standard PEAD strategy. The last column in Table IV confirms that there is significant PEAD in the full sample.
The baseline rolling strategy that is long the top 20% positive earnings news

umn in Table IV confirms that there is significant PEAD in the full sample.
The baseline rolling strategy that is long the top 20% positive earnings news
stocks and short the bottom 20% generates risk-adjusted returns of 1.242% per
month (t-statistic = 10.78). Negative (positive) earnings momentum stocks display negative (positive) return continuation, and the effect is monotonic with
increasing average returns as one moves from the bottom to the top quintile.
Such values are comparable to those reported in previous studies of the PEAD.
Table V reports monthly alphas for the main test assets. Separating stocks
according to their unrealized gains induces large differences in subsequent re-

according to their unrealized gains induces large differences in subsequent returns. The overhang spread, a strategy that holds a portfolio of top 20% positive
news stocks with large paper gains (top 20% capital gains) for 3 months and
offsets this position by shorting the bottom 20% negative news stocks with large
paper losses (bottom 20% capital gains), delivers abnormal returns of 2.433%
per month (t-statistic = 6.60).
The results support Hypothesis UR: bad (good) news travels slowly among
stocks with large unrealized capital losses (gains), generating large subsequent

returns for the overhang spread portfolio. Post-event returns of the negative
overhang spread are not significantly different from zero. When negative news
hits securities trading at large paper losses, it generates a severe post-event

* * *

Table IV

Post-Earnings Announcement Drift, Monthly Alphas 1980-2002

The Disposition Effect and Underreaction to News 2031
Table IV
Post-Earnings Announcement Drift, Monthly Alphas 1980–2002
At the beginning of every calendar month, stocks are ranked in ascending order on the basis of
their cumulative abnormal returns on the most recent earnings announcement date. The daily
abnormal returns are cumulated from the 2 days preceding the event date to 1 day after. Stocks are
assigned to one of five equally weighted quintile portfolios. This table includes all available stocks
and reports Fama and French (1993) three-factor alphas. The dependent variable is the monthly

|  | Earnings News Quintile |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| Rolling Period | 1(Bad) | 2 | 3 | 4 | 5(Good) | L/S |
| +1 | -0.558 | -0.253 | 0.014 | 0.232 | 0.595 | 1.152 |
| (-2.69) | (-1.84) | (0.11) | (1.82) | (3.20) | (8.17) |  |
| +2 | -0.512 | 0.044 | 0.137 | 0.215 | 0.657 | 1.169 |
| (-2.07) | (0.32) | (1.04) | (1.75) | (3.91) | (7.11) |  |
| +3 | -0.624 | -0.070 | 0.080 | 0.221 | 0.618 | 1.242 |
| (-3.22) | (-0.68) | (0.80) | (2.29) | (4.45) | (10.78) |  |

(−2.69) (−1.84) (0.11) (1.82) (3.20) (8.17)
+2 −0.512 0.044 0.137 0.215 0.657 1.169
(−2.07) (0.32) (1.04) (1.75) (3.91) (7.11)
+3 −0.624 −0.070 0.080 0.221 0.618 1.242

(−2.07) (0.32) (1.04) (1.75) (3.91) (7.11)
+3 −0.624 −0.070 0.080 0.221 0.618 1.242
(−3.22) (−0.68) (0.80) (2.29) (4.45) (10.78)
securities trading at large paper losses (gains), and post-event abnormal returns are on average zero.

securities trading at large paper losses (gains), and post-event abnormal returns are on average zero.
Using residual rather than raw overhang delivers similar results. The alpha
of the overhang spread is 2.201% (t-statistic = 6.56), but it is not significantly
different from zero for the negative overhang spread portfolio. The results show
that even after controlling for past returns, high overhang stocks underreact
to earnings news, which generates subsequent abnormal returns.
Table VI better illustrates the result by reporting returns for different overhang quintiles. In the table, portfolio #j is defined as a zero-cost portfolio that

securities trading at large paper losses (gains), and post-event abnormal re-
Using residual rather than raw overhang delivers similar results. The alpha
of the overhang spread is 2.201% (t-statistic = 6.56), but it is not significantly
different from zero for the negative overhang spread portfolio. The results show
that even after controlling for past returns, high overhang stocks underreact
to earnings news, which generates subsequent abnormal returns.
Table VI better illustrates the result by reporting returns for different overhang quintiles. In the table, portfolio #j is defined as a zero-cost portfolio that

Table VI better illustrates the result by reporting returns for different overhang quintiles. In the table, portfolio #j is defined as a zero-cost portfolio that
th
holds the top 20% good news stocks in the j overhang quintile and sells short

hang quintiles. In the table, portfolio #j is defined as a zero-cost portfolio that
th
holds the top 20% good news stocks in the j overhang quintile and sells short
th
the bottom 20% bad news stocks in the (6 − j) overhang quintile. Hence, port-

holds the top 20% good news stocks in the j overhang quintile and sells short
th
the bottom 20% bad news stocks in the (6 − j) overhang quintile. Hence, port-

j^{,\\mathrm{t h}}

(6-j)^{\\mathrm{t h}}

* * *

\| Table V

| Overhang Spread and Negative Overhang Spread Alphas |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Overhang Spread and Negative Overhang Spread Alphas
This table reports Fama and French (1993) three-factor alphas for the overhang spread and the negative overhang spread. At the beginning of
every calendar month, stocks are ranked in ascending order on the basis of their cumulative abnormal returns around the most recent earnings
announcement date and the most recent capital gains overhang. The overhang spread is defined as a zero-cost portfolio that holds the top 20% good
news stocks in the top (positive) overhang quintile and sells short the bottom 20% bad news stocks in the bottom (negative) overhang quintile. The
negative overhang spread is defined as a zero-cost portfolio that holds the top 20% good news stocks in the bottom (negative) overhang quintile and
sells short bottom 20% bad news stocks in the top (positive) overhang quintile. The residual overhang is obtained by regressing (cross-sectionally)
the raw overhang on previous 12- and 36-month return, the previous 12-month average turnover, and the log of market capitalization at end of the
Th
previous month. Alphas are in monthly percent,t-statistics are shown below the coefficient estimates, and 5% statistical significance is indicated in
eJ
bold. “Rolling period” is the holding period of the rolling strategy, in months.
ournal of Finance

* * *

Th
Monthly Alphas by Overhang Quintiles
e
This table reports Fama and French (1993) three-factor alphas for a long-short news strategy in different overhang quintiles. At the beginning ofDisposition Effect and Underreaction to News
every calendar month, stocks are ranked in ascending order on the basis of their cumulative abnormal returns around the most recent earnings
announcement date and the most recent capital gains overhang. Forj ∈ 1,...,5, portfoliojis defined as a zero-cost portfolio that holds the top 20%
good news stocks in thejoverhang quintile and sells short the bottom 20% bad news stocks in the (6 − j) overhang quintile. The last column reports
the difference between the overhang spread and the negative overhang spread. The residual overhang is obtained by regressing (cross-sectionally)
the raw overhang on previous 12- and 36-month returns, the previous 12-month average turnover, and the log of market capitalization at end of the
previous month. Alphas are in monthly percent,t-statistics are shown below the coefficient estimates, and 5% statistical significance is indicated in
bold. “Rolling period” is the holding period of the rolling strategy, in months.

| Rolling Period | (Negative Overhang Spread) |  |  |  |  | (Overhang Spread) |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (Overhang Spread)5 | 4 | 3 | 2 | 1 | 5-1 | 5 | 4 | 2 | 3 | (Negative Overhang Spread)15-1 |  |  |
| +1 | 2.077(5.45) | 1.878(6.08) | 0.914(3.29) | 1.309(3.48) | 0.798(1.84) | 1.279(1.85) | 2.153(5.10) | 1.577(4.99) | 1.572(5.35) | 1.572(4.03) | 0.670(1.58)(2.07) | 1.484(2.07) |
| +2 | 2.486(5.54) | 1.119(3.40) | 1.251(3.95) | 0.819(2.44) | -0.123(-0.27) | 2.609(3.36) | 2.266(5.57) | 1.315(3.72) | 0.988(3.01) | 0.780(2.50) | -0.129(-0.28)(3.37) | 2.395(3.37) |
| +3 | 2.433(6.60) | 1.615(6.43) | 0.973(4.87) | 0.613(2.78) | 0.092(0.28) | 2.341(3.64) | 2.201(6.56) | 1.522(6.25) | 1.243(6.82) | 0.863(4.92) | -0.160(-0.54)(4.16) | 2.361(4.16) |

\\frac{\\widehat{\\bigotimesangledown}}{\\widehat{\\big\ \ big}

* * *

2034 TheJournal of Finance
The results show that the bulk of the profitability of the PEAD is concentrated

The results show that the bulk of the profitability of the PEAD is concentrated
in high overhang stocks: Stocks with large unrealized capital gains tend to
underreact to, and only to, positive earnings surprises, while negative overhang
stocks underreact to, and only to, negative earnings news. This induces large
differences between the returns of the overhang spread and negative overhang
spread portfolios.
These results are consistent with Hypothesis UR: The post-event drift
anomaly is related to investors’ initial underreaction to news, either generated
or amplified by the rate at which investors tend to realize gains and losses.
The findings are consistent with an incomplete price discovery on the event
date. This is not, however, the only plausible explanation for the results of Tables IV–VI. In particular, suppose that stocks experiencing extreme earnings
news tend to be significantly exposed to a “news” factor that reflects systematic
risk not captured by the Fama and French model. In this case, the returns of
a PEAD strategy would be totally explained by a loading on a corresponding
traded factor. I cannot rule out a risk-based explanation simply based on the
results in Tables V and VI. Nevertheless, note that the cross-sectional variation
in returns induced by the capital gains sort is large enough to make same-news
strategies profitable. For example, looking at Table V, holding the bottom 20%

strategies profitable. For example, looking at Table V, holding the bottom 20%
bad news stocks with large paper gains for 3 months, and shorting the bottom
20% bad news with large paper losses generates an alpha of 97 basis points per

month (t-statistic = 2.99). Since this portfolio includes only bad news stocks,
it loads negatively on a news factor. Similar spreads can be constructed across

it loads negatively on a news factor. Similar spreads can be constructed across
different overhang quintiles and news stocks.

different overhang quintiles and news stocks.
Table VII reports factors loadings for the 3-month rolling strategy. The portfolios have similar market and size exposure. High capital gains stocks of either
Table VII
Three Factors Time-Series Regressions: Alphas and Factor Loadings

|  | Overhang Spread |  |  | Negative Overhang Spread |  |  |
| --- | --- | --- | --- | --- | --- | --- |
|  | Bad News | Good News | L/S | Bad News | Good News | L/S |
| $\\alpha(%)$ | -1.129 | 1.304 | 2.433 | -0.245 | -0.152 | 0.092 |
| (-3.51) | (9.56) | (6.60) | (-1.61) | (-0.57) | (0.28) |  |
| MKT | 1.216 | 1.064 | -0.152 | 1.038 | 1.164 | 0.126 |
| (14.76) | (30.47) | (-1.61) | (26.75) | (16.91) | (1.49) |  |
| SMB | 1.002 | 0.833 | -0.169 | 0.772 | 1.000 | 0.228 |
| (9.78) | (19.18) | (-1.44) | (16.01) | (11.69) | (2.17) |  |
| HML | -0.011 | -0.115 | -0.104 | -0.107 | 0.150 | 0.257 |
| (-0.09) | (-2.25) | (-0.75) | (-1.87) | (1.49) | (2.07) |  |
| R2 | 0.656 | 0.895 | 0.018 | 0.864 | 0.699 | 0.026 |

* * *

_The Disposition Effect and Underreaction to News_ 2035

news type are slightly more concentrated on growth stocks. The intercepts of the overhang spread are particularly eye catching (−1.129% and 1.304%). These large alphas stem from the fact that the bad news portfolio has persistently low returns, even though it is tilted toward small stocks, which would tend to raise expected returns. The second portfolio has higher returns but a negative load- ing on HML, which, ceteris paribus, should decrease expected returns. None of the factor loadings is significant for the long–short overhang spread, which is consistent with returns being driven by underreaction to the initial news con- tent, rather than reflecting systematic risk. Separating high overhang stocks has the effect of exacerbating the PEAD anomaly, since it allows for a substan- tial increase in returns with respect to a standard PEAD long–short strategy while maintaining a market-neutral risk profile.

## V. Liquidity, Size, and Trading Costs

Post-event price drift is consistent with a world in which firm-specific infor- mation diffuses only gradually across the investing public, and market partic- ipants only partially extrapolate information from prices. A priori, we would expect the drift to be most severe in stocks for which price discovery is likely to be sluggish, such as small stocks. 16

In a recent paper, Lesmonda, Schill, and Zhouc (2004) argue that momentum strategies require frequent trading in disproportionately high cost securities, such that trading costs prevent profitable strategy execution. 17 Trading fric- tions associated with small or illiquid stocks may explain why the drift appears to persist, but they cannot explain why it arises in the first place. To realize the overhang spread returns, the relevant investor must fully open and close both the long and the short positions. Thus, the execution requires paying the full spread and incurring the commissions, fees, and costs associated with price impact on four trades. Since trading costs vary according to firm size, I break the sample into size quintiles and compare the returns of the overhang strategy to the trading costs associated with executing these positions. 18 Since portfolios are equally weighted, round-trip trading costs are also equally weighted. Trading costs estimates are as follows: For each stock in the TAQ database, I obtain trades and quotes for a randomly selected day in each calendar month and I compute the average direct effective spread and commission on that trad- ing day. Monthly firm estimates are then computed using 12 monthly estimates obtained prior to inclusion in the portfolio. I use the standard approach to com- pute the effective spread as twice the absolute trading price deviation from the

16Hong, Lim, and Stein (2000) show that momentum profits are larger for stocks with low analyst coverage and for smaller stocks, once stocks in the lowest NYSE-size quintile are excluded from the sample. This result is consistent with underreaction caused by slow diffusion of information, as proxied by firm size or analyst coverage. 17Their analysis focuses on price, not earnings momentum. 18I use NYSE breakpoints.

* * *

2036 TheJournal of Finance

2036 TheJournal of Finance
bid-ask midpoint. I use a combination of price and tick tests to infer trade direc-
19
tion. The trade is classified as buyer initiated or seller initiated, respectively,
if the trade price is above or below the quote midpoint. If the trade occurred at
the midpoint, then the effective spread is zero.

the midpoint, then the effective spread is zero.
To compute commissions for each trade, I use a discount brokerage schedule
20
from CIGNA financial services. Since TAQ data are available only between
1993 and 2002, I assume that the average effective spread plus commissions
in the latter part of the sample period is a reasonable estimate for the period

1993 and 2002, I assume that the average effective spread plus commissions
in the latter part of the sample period is a reasonable estimate for the period
21
1980 to 1992.
I set a minimum liquidity threshold by disallowing trading in stocks with a
closing price below $3 at the end of the previous month. This ensures that both
the returns and the trading costs estimates are not contaminated by illiquid
micro cap securities.
Table VIII reports results for the overhang spread portfolios across size
quintiles. For each portfolio, I report the Fama–French alpha, the average
turnover, the average trading cost, and the maximum trading cost. The latter is defined as the round-trip trading cost necessary to eliminate the ab-

ter is defined as the round-trip trading cost necessary to eliminate the abnormal return, given the portfolio turnover. The t-statistic tests the hypothesis that average trading costs exceed the maximum threshold. Last, I report
the alpha net of trading costs and the average net semiannual buy-and-hold
return. I use the actual monthly turnover to compute the time series of net
returns.
The results strongly confirm the previous findings: Stock prices underreact
to bad news when more current holders are facing a capital loss, and underreact

to good news when more current holders are facing a capital gain. Abnormal
returns of the overhang spread portfolios are statistically significant and eco-

returns of the overhang spread portfolios are statistically significant and economically large across all the size subsamples, and as conjectured, they tend to
be larger for small stocks, for which information asymmetries are more likely

| Dollar Volume(V) |  |  | Commissions |
| --- | --- | --- | --- |
| $0 | - | 2,500 | $29+1.70%V |
| 2,500.01 | - | 6.250 | 55+0.66%V |
| 6,250.01 | - | 20,000 | 75+0.34%V |
| 20,000.01 | - | 50,000 | 99+0.22%V |
| 50,000.01 | - | 500,000 | 154+0.11%V |
| 500,000 | + |  | 254+0.09%V |

$0 − 2,500 $29+1.70% V
2,500.01 − 6.250 55+0.66% V
6,250.01 − 20,000 75+0.34% V
20,000.01 − 50,000 99+0.22% V
50,000.01 − 500,000 154+0.11% V

50,000.01 − 500,000 154+0.11% V
500,000 + 254+0.09% V

* * *

|  | All |  | 1(Small) |  | 2 |  | 3 |  | 4 |  | 5(Large) |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NYSE Quintile | 3 | 6 | 3 | 6 | 3 | 6 | 3 | 6 | 3 | 6 | 3 | 6 |
| Rolling period |  |  |  |  |  |  |  |  |  |  |  |  |
| Fama-French alpha | 2.447(7.88) | 1.922(6.65) | 2.777(8.02) | 2.052(6.71) | 2.480(6.45) | 1.970(6.09) | 2.554(5.84) | 2.017(5.20) | 1.466(3.26) | 1.464(3.89) | 1.308(3.20) | 1.165(3.60) |
| Average turnover | 34.3 | 18.7 | 36.1 | 20.0 | 36.0 | 19.8 | 36.1 | 19.7 | 35.5 | 19.1 | 34.3 | 18.4 |
| Max trading cost | 7.12 | 10.23 | 7.67 | 10.23 | 6.87 | 9.90 | 7.06 | 10.23 | 4.12 | 7.64 | 3.81 | 6.32 |
| Effective spreadplus commissions | 4.55(39.8) | 4.58(102.7) | 7.67(-0.2) | (28.2) | 4.02(48.7) | 4.08(104.7) | 2.87(83.4) | 2.95(140.8) | 2.08(12.7) | 2.06(61.6) | 1.44(58.3) | 1.42(142.3) |
| Net alpha | 0.885(2.76) | 1.062(3.62) | -0.002(-0.01) | 0.521(2.36) | 1.028(2.63) | 1.158(3.54) | 1.511(3.43) | 1.435(3.67) | 0.726(1.60) | 1.071(2.84) | 0.816(1.98) | 0.904(2.79) |
| Semiannual returnafter trading cost | 3.870(3.39) | 4.915(4.84) | -1.559(-1.12) | 1.741(2.50) | 1.741(2.60) | 4.960(3.84) | 6.805(4.20) | 6.017(4.65) | 2.230(1.30) | 3.938(1.30) | 3.298(1.82) | 3.865(2.58) |

* * *

2038 TheJournal of Finance

2038 TheJournal of Finance
Dropping low-priced stocks increases the magnitude of the drift, due to the
fact that micro cap stocks tend to exhibit reversals induced by supply shocks.
None of the alphas of the negative overhang spread portfolios (not reported) is
significantly different from zero.
Furthermore, the trading costs associated with these positions do not prevent
profitable strategy execution. The baseline overhang spread portfolio delivers
net monthly alphas of 0.885% and 1.062% depending on the holding period
of the underlying rolling strategy. On a net basis, returns are higher for the
22
6-month strategy, as the lower turnover more than compensates the reduction
in returns with respect to the 3-month strategy. The 6-month overhang strategy
delivers semiannual buy-and-hold returns between 1.7% and 6%, which is a

delivers semiannual buy-and-hold returns between 1.7% and 6%, which is a
significant achievement given the fact that these are zero-beta returns. Taking
small stocks into account has two conflicting effects on the net alpha: On the one
hand, the price discovery is more sluggish; on the other hand, the transaction
23
costs are higher. This explains why the highest net returns are found for
midsize stocks.

An extensive battery of additional robustness tests is reported in the Appendix. All the results tell a consistent story, namely, signed overhang predicts

subsequent returns. The post-event drift is larger when the news and the capital
gains overhang have the same sign: Bad (good) news travels slowly among negative (positive) overhang stocks, generating post-event return predictability.
VI. Conclusion
This paper suggests that the disposition effect can induce underreaction to
news, leading to return predictability and post-announcement price drift. The
price pattern depends on both the information content of the news and the

large capital gains, in turn leading to a positive price drift. This paper provides
a test of this hypothesis.
I propose a new method to compute a measure of the aggregate basis for
individual stocks that relies on holdings data. I use a database of mutual funds
holdings to construct a measure of reference prices for individual stocks. I then
use the gain (loss) to construct a test of stock price underreaction to news.
The calendar-time rolling method used in the portfolio approach allows for

a straightforward test and controls for cross-correlation among event stocks,
which tends to invalidate inference in event studies performed in event time.

which tends to invalidate inference in event studies performed in event time.
The focus here is on short-term underreaction. Hence, the asset pricing model
misspecification problem, typical of long-term event studies, is less likely to

* * *

_The Disposition Effect and Underreaction to News_ 2039

procedure as an executable investment strategy whose risk profile and perfor- mance can be assessed using simple time-series regressions. The results show that because investors initially underreact to news an- nouncements, stocks with large unrealized capital gains have higher subse- quent returns, thereby generating a predictable price drift. The post-event predictability is most severe where the disposition effect pre- dicts the largest underreaction. Post-event drift is larger when the news and the overhang have the same sign, and the magnitude of the post-earnings an- nouncement drift is directly related to the amount of unrealized capital gains (losses) experienced by the stock holders at the event date. Stocks with large unrealized capital gains underreact to, and only to, positive news, while stocks with large unrealized capital losses underreact to, and only to, negative news. These findings are consistent with a world in which trading frictions, captured by the capital gains overhang, impede a speedy transmission of information to stock prices via price impact. Capital gains will predict returns under alternative hypotheses that do not rely on the disposition effect. Suppose that the overhang is simply a measure of the holding period of the stock holders, that is, some stocks have “loyal” holders who sell very rarely. Since, on average, stock prices increase over time, stocks with loyal holders will have large unrealized gains. Since loyal holders are slow to react to signals, it may take a while for the market to incorporate good news, thereby generating post-event drift. Another alternative hypothesis is that because some stocks have low turnover and are generally illiquid, they have loyal holders. Since lower than average turnover and positive historical returns means high overhang stocks, overhang will be negatively correlated with turnover and positively correlated with size. This is consistent with the empirical findings reported in Subsection B. Small and illiquid stocks react less to good news since they react less to any news, as they do not trade often. In this world, residual overhang will be a better predictor of returns than raw overhang. Finally, since reference prices are share weighted, there is the possibility that capital gains capture disagreement about a stock. In the presence of short sale constraints, stocks with greater disagreement have lower expected returns. 24

Although it is possible that the capital gains overhang captures liquidity- related factors, none of the hypotheses above can explain the asymmetry in the price response to news: Return predictability is most severe when capital gains and the event have the same sign. Stocks with large unrealized gains underreact to good news, and to good news only, and stocks with large unreal- ized losses only underreact to negative news. Overhang is not just a proxy for liquidity since the response is in one direction for positive news, and a different direction for negative news. This asymmetric pattern is consistent with the disposition effect because the latter predicts signed order flows as a function of the difference between the current and the reference prices. When facing a capital loss, disposition

24Miller (1977).

* * *

## 2040 TheJournal of Finance

investors are reluctant to realize the loss, thereby generating underreaction to negative news. Similarly, their active selling prevents a stock price from rising immediately to its new level on positive news announcements. As a result, post- event risk-adjusted returns can be achieved by using a sort on the capital gains overhang, suggesting that such a variable predicts the gradual market response to new information.

**Appendix**

_A. Mutual Fund Ownership and Index Funds_ Capital gains are meant to be the best estimate of the stock’s cost basis to the representative investor. Since reference prices are constructed using mutual fund holdings, it is plausible for this measure to be more relevant for stocks mostly held by mutual funds, and less relevant for stocks mostly held by retail investors. I address this issue by splitting the sample into stocks with high and low mutual fund ownership, where ownership is defined as the percent- age of shares held by mutual funds. I use the median ownership at the end of the previous month as the breakpoint. The results in Table A1 show that separating stocks by mutual fund ownership has little effect on the magni- tude of the overhang spread. The difference in returns between the overhang and the negative overhang spreads is large and significant for both groups of stocks. This result is consistent with the cross-section of mutual fund managers’ capital gains being a good approximation of the cross-section of gains experi- enced by all shareholders. To further test this hypothesis, I run an additional robustness test. Suppose, we can identify a subset of managers that, a priori, are known not to be prone to the disposition effect. The cross-section of gains and losses for this subset of managers should not provide any information to identify stocks that will underreact to news.
25 Such a class is easy to identify, namely, index funds. Index funds and exchange traded funds (ETFs) cannot be prone to the disposition effect since their holdings are driven by the index com- position. Therefore, I compute the capital gains overhang using only holdings of index funds and ETFs, and I construct the two main test assets. If the presence of disposition managers is driving the results in Tables V and VI, then, restrict- ing the sample to index funds only, we should not be able to detect a difference in returns between the overhang spread and the negative overhang spread. Rather, we should observe a mean news effect (i.e., the standard univariate PEAD, bad (good) news stocks should have lower (higher) subsequent returns), but the second sort on capital gains should be close to a sort on pure noise. The evidence in Table A1 confirms this intuition. Separating stocks using index funds’ capital gains does not generate systematic differences in returns. The overhang spread and the negative overhang spread earn similar risk-adjusted returns, close to 60 basis point per month.

I would like to thank Toby Moskovitz for suggesting this test.

* * *

Table A1 Robustness Checks

The Disposition Effect and Underreaction to News 2041
Table A1
Robustness Checks
This table reports Fama and French (1993) three-factor alphas for the three-month overhang spread
and the negative overhang spread. Panels A and B report results for subsamples based on mutual
funds ownership. The breakpoint is the median ownership at the end of the previous month. Panel
C reports results for capital gains constructed using index funds and ETFs only. Panels D and E
report results for a turnover-based overhang. The fraction number of shares purchased at date t −
n still held by the original purchasers at date t is computed as Vt,t−n= TOt−n· πtn=−01(1 − TOt−n+τ),
where TOtis turnover in month t.Panel F reports characteristics-adjusted returns using a single
control firm matched on size, book-to-market, and price momentum. Panel G reports results for
portfolios constructed using standardized unexpected earnings (SUE) as measure of earnings news.
SUE = (e − e)/σ, where e is the most recent quarterly earnings per share as of month t, e is

V\_{t,t-n}=T0\_{t-n}\\cdot\\pi\_{t=0}^{n-1}(1-T0\_{t-n+\\tau}),

T O\_{t}

S!!{\\it E E}=(e-e\_{-4})/\\sigma

e\_{t}-e\_{t-4}

|  |  | Overhang Spread |  |  | Negative Overhang Spread |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bad News | Good News | L/S | Bad News | Good News | L/S |  |  |
| A | Low mutual fund ownership | -1.098(-2.95) | 1.337(8.16) | 2.435(6.28) | -0.284(0.03) | 0.010(-1.59) | 0.275(0.85) |
| B | High mutual fund ownership | -1.083(-3.88) | 1.202(8.33) | 2.284(6.49) | -0.083(-0.87) | -0.222(-0.55) | -0.140(-0.42) |
| C | Only index funds | -0.293(-2.43) | 0.348(1.45) | 0.641(2.70) | -0.285(-2.56) | 0.313(1.99) | 0.599(2.81) |
| D | Turnover-based gains,1963-1979 | -1.014(-2.61) | 1.533(5.48) | 2.547(5.01) | 0.202(0.58) | 0.213(0.69) | 0.012(0.03) |
| E | Turnover-based gains,1980-2003 | -0.559(-2.36) | 1.361(7.40) | 1.920(4.79) | -0.141(0.93) | 0.299(-0.75) | 0.440(1.67) |
| F | Characteristics matched returns | -0.920(-4.30) | 0.931(3.32) | 1.851(5.60) | 0.011(0.90) | -0.014(-0.04) | -0.025(-0.04) |
| G | Standardized unexpected earnings | -0.672(-2.52) | 1.066(8.28) | 1.738(5.26) | -0.049(0.99) | 0.278(-0.27) | 0.339(0.97) |
| H | Analysts' revisions | -1.568(-2.07) | 1.193(3.43) | 2.761(2.84) | 0.159(-0.95) | -0.652(0.53) | -0.811(-1.01) |

G Standardized −0.672
unexpected earnings (−2.52)

H Analysts’ −1.568 1.193 2.761 0.159 −0.652 −0.811
revisions (−2.07) (3.43) (2.84) (−0.95) (0.53) (−1.01)
B. Out-of-Sample Evidence
Using holdings limits analysis to the period 1980 to 2002, for which mutual fund data are available, and relies on the assumption that mutual fund

t-n

managers are a random sample of the population of shareholders. I repeat the
analysis by splitting the sample into the two subperiods, 1962 to 1979 and

\\hat{V} _{t,t-n}=T,O_{t-n}\\left\[\\prod\_{\\tau=1}^{n-1}(\\mathbf{1}-T O\_{t-n+\\tau})\\right\],

* * *

## 2042 TheJournal of Finance

where TO _t_ is turnover in month t. The reference price is estimated as before using

∑ _t_ _RPt_ = φ −1 _Vˆt,t−nPt−n_. (A2) _n=0_

This measure has the following interpretation. If a stock had high turnover a year ago, but volume has been very low ever since, then most of the current holders probably bought the stock a year ago, so we can use the past year’s price as a proxy for the purchase price. Similarly, if a stock had high turnover in the past month, most investors probably bought it recently, so we can use last month’s average or closing price as a proxy for the purchase price. More pre- cisely, suppose that turnover ratios correspond to trading probabilities. Then _Vˆt,t−n_ is equal to the probability that a share is traded at date t − n and never traded again up to date t. Hence, Vˆ _t,t−n_ is equal to the probability that the reference price is equal to the price at t − n.Averaging over all possible refer- ence prices gives the estimated cost basis for the market. Results in Table A1 are consistent with the previous findings: Stocks with large unrealized gains (losses) severely underreact to positive (negative) news. Not surprisingly, in the overlapping period 1980 to 2002, abnormal returns are lower and more volatile (lower t-statistic) with respect to the holdings measure. Using holdings allows one to directly measure, for each stock, the typical capital gain or loss for an investor in that stock. Hence, we expect this proxy to provide a more efficient estimator of aggregate capital gains than volume.

_C. Characteristics-Adjusted Returns_ Daniel and Titman (1998a, 1998b) suggest that characteristics can be bet- ter predictors of future returns than factor loadings. I follow Barber and Lyon (1997) and measure abnormal returns comparing the return of event stocks to that of a single control stock. First, using conditional sorts and NYSE break- points, all stocks in the sample are assigned to one of 125 (5 × 5 × 5) charac- teristics portfolios based on size, book to market (B/M), and returns in previous 12 months. To find a match for a given sample stock, all the non-event stocks in the same characteristics portfolio are ranked based on the difference be- tween the sample stock and the matching stock on each characteristic. Ranks are summed across the different characteristics, and the lowest rank is se- lected as the matching stock. The match is maintained until the next event or the delisting date. If a match becomes unavailable at a given point, either because of delisting or because it has an earnings announcement, then from that point forward, it is replaced by the second-lowest-ranked stock. This pro- cedure ensures that there is no look-ahead bias. I subtract the size-, B/M-, and momentum-matched returns from stock returns and then calculate calendar- time rolling returns as before. Results in Table A1 confirm that even after con- trolling for past returns, security prices tend to underreact to public news and

* * *

_The Disposition Effect and Underreaction to News_ 2043

the magnitude of such post-event drift is indeed predictable by the signed over- hang. The overhang spread portfolio consistently earns higher risk-adjusted returns than the negative overhang spread portfolio.

_D. Standardized Unexpected Earnings_ Using returns around the most recent event day provides a clean and easy waytomeasure earnings surprises since it does not require a model for ex- pected earnings. Nevertheless, it may also have some drawbacks. Event-day returns only capture changes over a window of a few days of the market’s view about earnings. On the other hand, an accounting-based measure of earnings news incorporates information up to the last quarter, and hence should reflect earnings surprises over a longer period. Jegadeesh et al. (1996) show that differ- ent measures of earnings surprises may have low correlation, suggesting that different surprise definitions may capture different aspects of the market’s ex- pectation of earnings releases. I use standardized unexpected earnings defined as sue _t_ = (e _t_ − e _t−4_)/σ, where e _t_ is the most recent quarterly earnings per share as of month t, e _t−4_ is the earnings per share four quarters before month t, and σ is the standard deviation of unexpected earnings (e _t_ − e _t−4_) over the preceding eight quarters. The results in Table A1 are strikingly similar to the previous findings: Bad (good) news travels slowly among negative (positive) overhang stocks, thereby generating post-event return predictability. The lower magni- tude of the drift may be due to the fact that strategies based on accounting surprises and market impact exploit market underreaction to separate pieces of information embedded in different news proxies.
_E. Analysts’ Stock Recommendation Revisions_ The underreaction hypothesis is not specific to earnings announcements but can be applied to any situation in which firm specific information is released. I use an additional long–short strategy that mimics the most recent changes in analysts’ stock recommendations. Analysts’ recommendation revisions have been found to have predictive power for future stock returns.
26 In particular, upgraded stocks outperform downgraded stocks, implying that stock prices do not adjust immediately to a recommendation revision. Brokers’ and analysts’ recommendations are from the I/B/E/S database. The Recommendations Detail file contains analysts’ ratings for a particular company: Each recommendation is assigned a numeric value and mapped to one of the I/B/E/S standard ratings from 1 (strong buy ) to 5 (sell). I use the I/B/E/S rating code to compute changes in recommendations for each analyst following a particular stock, since the most recent recorded value. Analysts’ revisions’ event days are defined as the trading days on which at least one revision occurs. The data run from January 1993 to December 2002. The news proxy is the market model cumulative abnormal returns around the most recent revision date. Results in Table A1 confirm the

26See Womack (1996) and more recently Jegadeesh et al. (2004).

* * *

## 2044 TheJournal of Finance

previous findings: The overhang spread portfolio displays price drift following analysts’ recommendation changes.

**REFERENCES**

Abarbanell, Jeffery S., and Victor Bernard, 1992, Analysts’ overreaction/underreaction to earnings information as an explanation for anomalous stock price behavior, Journal of Finance 47, 1181–1207. Affleck-Graves, John, and Richard R. Mendenhall, 1992, The relation between the value line enigma and post-earnings-announcement drift, Journal of Financial Economics 31, 75–96. Ball, Ray, and Eli Bartov, 1996, How naive is the stock market use of earnings information, Journal _of Accounting and Economics 21, 319–337._ Ball, Ray, and Philip Brown, 1968, An empirical evaluation of accounting income numbers, Journal _of Accounting Research 6, 159–178._ Barber, Brad, and John D. Lyon, 1997, Detecting abnormal operating performance: The empirical power and specification of test statistics, Journal of Financial Economics 41, 341–372. Barber, Brad, and Terrance Odean, 2000, Trading is hazardous to your wealth: The common stock investment performance of individual investors, Journal of Finance 55, 773–806. Barber, Brad, and Terrance Odean, 2001, Boys will be boys: Gender overconfidence and common stock investment, Quarterly Journal of Economics 116, 261–292. Barber, Brad, and Terrance Odean, 2002, Online investors: Do the slow die first? Review of Finan- _cial Studies 15, 455–487._ Barberis, Nicholas, Ming Huang, and Tano Santos, 2002, Prospect theory and asset prices, Quar- _terly Journal of Economics 116, 1–54._ Barberis, Nicholas, Ming Huang, and Richard Thaler, 2003, individual preferences monetary gam- bles and the equity premium, NBER Working paper no. W-9997 December 2003. Bernard, Victor, and Jacob Thomas, 1989, Post-earnings announcement drift: Delayed price re- sponse or risk premium? Journal of Accounting Research 27, 1–36. Bernard, Victor, and Jacob Thomas, 1990, Evidence that stock prices do not fully reflect the im- plications of current earnigns for future earnings, Journal of Accounting and Economics 13, 305–340. Bjerring, James H., Josef Lakonishok, and Theo Vermaelen, 1983, Stock prices and financial ana- lysts’ recommendations, Journal of Finance 38, 187–204. Brown, Philip R., Nick Chappel, Raymond da Silva Rosa, and Terry Stirling Walter, 2002, The reach of the disposition effect: Large sample evidence across investor classes, Working paper, Lancaster University. Chan, Wesley, 2003, Stock price reaction to news and no-news: Drift and reversal after headlines, _Journal of Financial Economics 70, 223–260._ Collins, Daniel W., and Paul Hribar, 2000, Earnings based and accrual based market anomalies: One effect or two? Journal of Accounting and Economics 29, 101–123. Coval, Joshua, and Tyler Shumway, 2000, Do behavioral biases affect prices? Working paper, Uni- versity of Michigan. Daniel, Kent, and Sheridan Titman, 1998a, Characteristics or covariances? Journal of Portfolio _Management 24, 24–33._ Daniel, Kent, and Sheridan Titman, 1998b, Evidence on the characteristics of cross-sectional vari- ation in common stock returns, Journal of Finance 52, 1–33. Desai, Hemang, and Jain C. Prem, 1997, Long-run common stock returns following stock splits and reverse splits, Journal of Business 70, 409–434. Dhar, Ravi, and Z. Ning Zhou, 2002, Up close and personal: An individual level analysis of the disposition effect, Yale ICF Working paper no. 02-20. Eberhart, Allan C., William F. Maxwell, and Akhtar R. Siddique, 2004, Returns and operating performance following R&D increases, Journal of Finance 59, 623–650. Elton, Edwin J., Martin J. Grueber, and Mustafa N. Gultekin, 1984, Professional expectations accuracy and diagnosis of errors, Journal of Financial and Quantitative Analysis 19, 351–363.

* * *

_The Disposition Effect and Underreaction to News_ 2045

Fama, Eugene, 1998, Market efficiency, long term returns and behavioral finance, Journal of Fi- _nancial Economics 49, 283–306._ Fama, Eugene, and Kenneth French, 1993, Common risk factors in the returns on stocks and bonds, _Journal of Financial Economics 33, 3–56._ Fama, Eugene, and James MacBeth, 1973, Risk, return, and equilibrium: Empirical tests, Journal _of Political Economy 81, 607–636._ Ferris, Stephen, Robert Haugen, and Anil Makhija, 1988, Predicting contemporary volume with historic volume at differential price levels: Evidence supporting the disposition effect, Journal _of Finance 43, 677–699._ Foster, George, Chris Olsen, and Terry Shevlin, 1984, Earnings releases, anomalies, and the be- havior of security returns, The Accounting Review 59, 574–603. Grinblatt, Mark, and Bin Han, 2005, Prospect theory, mental accounting, and momentum, Journal _of Financial Economics 78, 311–339._ Grinblatt, Mark, and Matti Keloharju, 2001, What makes investors trade? Journal of Finance 56, 589–616. Grinblatt, Mark, Ronald W. Masulis, and Titman Sheridan, 1984, The valuation effects of stocks splits and stock dividends, Journal of Financial Economics 13, 97–112. Groth, John C., Wilbur G. Lewellen, Gary C. Scharbaum, and Ronald C. Lease, 1979, An analysis of brokerage house securities recommendations, Financial Analysts Journal 35, 32–40. Hong, Harrison, Terrence Lim, and Jeremy C. Stein, 2000, Bad news travels slowly: Size, analyst coverage, and the profitability of momentum strategies, Journal of Finance 55, 265–295. Ikenberry, David, Rankine Gaeme, and Earl K. Stice, 1996, What do stock splits really signal? _Journal of Financial and Quantitative Analysis 31, 357–375._ Ikenberry, David, Josef Lakonishok, and Theo Varmaelen, 1995, Market underreaction to open market repurchases, Journal of Financial Economics 39, 181–208. Jegadeesh, Narasimhan, Louis K.C. Chan, and Josef Lakonishok, 1996, Momentum strategies, _Journal of Finance 51, 1681–1713._ Jegadeesh, Narasimhan, Joonghyuk Kim, Susan Krische, and Charles Lee, 2004, Analyzing the analysts: When do recommendations add value? Journal of Finance 59, 1083–1124. Jegadeesh, Narasimhan, and Sheridan Titman, 1993, Returns to buying winners and selling losers: Implications for stock market efficiency, Journal of Finance 48, 65–91. Joy, Maurice, Robert Litzenberger, and Richard McEnally, 1977, The adjustment of stock prices to announcements of unanticipated changes in quarterly earnings, Journal of Accounting Re- _search 15, 207–225._ Kahneman, Daniel, and Amos Tversky, 1979, Prospect theory: An analysis of decision under risk, _Econometrica 47, 263–291._ Lakonishok, Josef, and Theo Vermaelen, 1990, Anomalous price behavior around repurchase tender offers, Journal of Finance 45, 455–477. Lee, Charles, and Mark Ready, 1991, Inferring trade direction from intradaily data, Journal of _Finance 46, 733–746._ Lesmonda, David A., Michael J. Schill, and Chunsheng Zhouc, 2004, The Illusory nature of mo- mentum profits, Journal of Financial Economics 71, 349–380. Locke, Peter, and Steven Mann, 2000, Do professional traders exhibit loss realization aversion? Working paper, The George Washington University and Texas Christian University. Lougran, Tim, and Jay Ritter, 1995, The new issues puzzle, Journal of Finance 50, 23–52. Mendenhall, Richard, 1991, Evidence of possible underweighting of earnings-related information, _Journal of Accounting Research 29, 170–140._ Miller, Edward, 1977, Risk, uncertainty and divergence of opinion, Journal of Finance 32, 1151–

Odean, Terrance, 1998, Are investors reluctant to realize their losses? Journal of Finance 53, 1775–

Odean, Terrance, 1999, Do investors trade too much? American Economic Review 89, 1279–1298. Rendleman, Richard, Charles Jones, and Henry Latane, 1982, Empirical anomalies based on unex- pected earnings and the importance of risk adjustments, Journal of Financial Economics 10, 269–287.

* * *

## 2046 TheJournal of Finance

Seyhun, H. Nejat, 1986, Insiders’ profits, cost of trading and the market efficiency, Journal of _Financial Economics 61, 189–212._ Seyhun, H. Nejat, 1988, The information content of aggregate insider trading, Journal of Business 61, 1–24. Shapira, Zur, and Itzhak Venezia, 2001, Patterns of behavior of professionally managed and inde- pendent investors, Journal of Banking and Finance 25, 1573–1587. Shefrin, Hersh, and Meir Statman, 1985, The disposition to sell winners too early and ride losers too long: Theory and evidence, Journal of Finance 40, 777–791. Tarun, Chordia, and Lakshmanan Shivakumar, 2002, Earnings, business cycle and stock returns, Emory University and London Business School Working paper. Teoh, Siew Hong, Ivo Welch, and T. J. Wong, 1998, Earnings management and the under- performance of seasoned equity offering, Journal of Financial Economics 50, 63–99. Thaler, Richard, 1985, Mental accounting and consumer choice, Marketing Science 4, 199–214. Wermers, Russell, 2003, Is money really “smart?” New evidence on the relation between mutual fund flows, manager behavior, and performance persistence, Working paper, University of Maryland. Womack, Kent L., 1996, Do brokerage analysts’ recommendations have investment value? Journal _of Finance 51, 137–168._