/*
 * PXT for KRC Microbit Control Bord
 * Copyright 2019 Bitcom 
 *                GNU
 *
 * Version 2019-06-02 0.20
 * Version 2019-10-01 0.30 Add Control-Pad
 * Version 2019-10-16 0.40 Add EEP function area
*/
//% weight=10 color=#ADB367 icon="\f085" block="KRC-TOOL"
namespace KRCmotor {
    /* ４つのDCモータの選択 */
    export enum Motors {
        M1 = 0x1,
        M2 = 0x2,
        M3 = 0x3,
        M4 = 0x4
    }

    /* DCモータの回転方向の指定 */
    export enum Dir {
        STOP = 0,
        FWD = 1,
        REV = 2
    }
    export enum Dir1 {
        STOP = 0,
        FWD = 1,
        REV = 2
    }
    export enum Dir2 {
        STOP = 0,
        FWD = 1,
        REV = 2
    }
    export enum Dir3 {
        STOP = 0,
        FWD = 1,
        REV = 2
    }

    /* コントロールパッドのボタンの選択 */
    export enum ControllerSw {
        SWA = 0x1,
        SWB = 0x2,
        SWC = 0x4,
        SWD = 0x8,
        SWE = 0x10,
        SWF = 0x20,
        SWG = 0x40,
        SWH = 0x80
    }

    /* コントロールパッドのビット定義 */
    export enum BitOnOff {
        OFF = 0,
        ON = 1
    }

    /* EEPROM の定義 */
    const EEPROM_I2C_ADDR = 80	// EEPのI2Cアドレス
    const MAX_EEP_TIME = 65500	// EEP最大記録時間 655秒
    const MAX_EEP_ADDR = 32760	// EEP最大アドレス 32760 byte　8190 dword
    const FUNC_EEP_ADDR = 32764	// EEPファンクション記録アドレス 32764-7 7FF8h-7FFFh 4byte
    let EEPerr = 0				// eepromの状態　0:OK 1:EOF 2:Error
    let eep_write_addr = 0		// EEPROMの書き込みアドレス
    let eep_mode = 0    		// 状態 0:待機 1:読み込み 2:書き込み
    let eep_read_addr = 0		// EEPROMの読み込みアドレス
    let rec_start_tm = 0		// 記録時の開始時間
    let play_start_tm = 0		// 再生時の開始時間
    let last_controls = 0		// 記録時：前回の操作内容
    let elapsed_tm = 0			// 経過時間
    let eep_next_tm = 0			// 再生時：EEPROMに記録されている操作時間
    let eep_next_cont = 0		// 再生時：EEPROMに記録されている操作内容
    let eep_markstr = 0         // EEP先頭のコード

    /* モータ出力の定義 */
    let pwm1init = false
    let pwm2init = false
    let pwm3init = false
    let pwm4init = false

    /* コントロールパッドのチャタリング除去 */
    let use_controller = false  // コントローラ利用中フラグ　モータとの重複を防ぐ
    let sw_cont0_3 = 0
    let sw_cont0_2 = 0
    let sw_cont0_1 = 0
    let sw_cont0 = 0            // チャタリング除去後ボタンデータ AnalogPin.P0
    let sw_cont1_3 = 0
    let sw_cont1_2 = 0
    let sw_cont1_1 = 0
    let sw_cont1 = 0            // チャタリング除去後ボタンデータ AnalogPin.P1
    let sw_status = 0           // 全コントロールパッドのボタン状態
    let sw_last_status = 0      // 全コントロールパッドのボタン状態（以前の状態）
    let sw_last_detect_tm = 0   // チャタリング除去時間

	/*
	 * アナログ抵抗値からコントロールパッドのスイッチデータを返す
     * 4ビットのビットパターンになっていて、複数ボタンの情報がわかる
     *      A                        
     *   C  +  D →→→　D C B A
     *      B    
    */
    /**
     * analog controller to digital bit pattern
     * @param anada controller analog input data
     */
    function set_swdat_from_anadat(anadat: number): number {
        if (anadat < 98) return 5		//B0101;// A+C
        if (anadat < 248) return 9		//B1001;// A+D
        if (anadat < 356) return 1		//B0001;// A
        if (anadat < 437) return 6		//B0110;// B+C
        if (anadat < 501) return 10		//B1010;// B+D
        if (anadat < 552) return 2		//B0010;// B
        if (anadat < 594) return 4		//B0100;// C
        if (anadat < 630) return 8		//B1000;// D
        return 0						//B0000;// NC
    }

    /**
     * Update all analog controller bit pattern without chattering
     */
    function set_swstatus_without_chattering(): boolean {
        if (input.runningTime() - sw_last_detect_tm < 20) return false	//チャタリング除去間隔を経過したか？
        sw_last_detect_tm = input.runningTime()		// 更新
        use_controller = true
        // Check analog controller
        // contrller 0
        sw_cont0_3 = sw_cont0_2
        sw_cont0_2 = sw_cont0_1
        sw_cont0_1 = set_swdat_from_anadat(pins.analogReadPin(AnalogPin.P0))
        if (sw_cont0_1 == sw_cont0_2 && sw_cont0_1 == sw_cont0_3) sw_cont0 = sw_cont0_1
        // contrller 1
        sw_cont1_3 = sw_cont1_2
        sw_cont1_2 = sw_cont1_1
        sw_cont1_1 = set_swdat_from_anadat(pins.analogReadPin(AnalogPin.P1))
        if (sw_cont1_1 == sw_cont1_2 && sw_cont1_1 == sw_cont1_3) sw_cont1 = sw_cont1_1
        sw_status = sw_cont1 * 16 + sw_cont0
        return true
    }

    /**
     * write a byte to special address
     * @param addr eeprom address, eg: 2
     * @param dat is the data will be write, eg: 6
     */
    function eep_write_byte(addr: number, dat: number): void {
        let buf = pins.createBuffer(3)
        buf[0] = addr >> 8
        buf[1] = addr
        buf[2] = dat
        pins.i2cWriteBuffer(EEPROM_I2C_ADDR, buf)
    }
    /**
     * read a byte from special address
     * @param addr eeprom address, eg: 2
     */
    function eep_read_byte(addr: number): number {
        pins.i2cWriteNumber(EEPROM_I2C_ADDR, addr, NumberFormat.UInt16BE)
        return pins.i2cReadNumber(EEPROM_I2C_ADDR, NumberFormat.UInt8BE)
    }

    /**
     * write a word to special address
     * @param addr eeprom address, eg: 2
     * @param dat is the data will be write, eg: 6
     */
    function eep_write_word(addr: number, dat: number): void {
        let buf = pins.createBuffer(4)
        buf[0] = addr >> 8
        buf[1] = addr
        buf[2] = dat >> 8
        buf[3] = dat
        pins.i2cWriteBuffer(EEPROM_I2C_ADDR, buf)
    }

    /**
     * write a dword to special address
     * @param addr eeprom address, eg: 4
     * @param dat is the data will be write, eg: 7
     */
    function eep_write_dword(addr: number, dat: number): void {
        let buf = pins.createBuffer(6)
        buf[0] = addr >> 8
        buf[1] = addr
        buf[2] = dat >> 24
        buf[3] = dat >> 16
        buf[4] = dat >> 8
        buf[5] = dat
        pins.i2cWriteBuffer(EEPROM_I2C_ADDR, buf)
    }

    /**
     * read a word from special address
     * @param addr eeprom address, eg: 2
     */
    function eep_read_word(addr: number): number {
        pins.i2cWriteNumber(EEPROM_I2C_ADDR, addr, NumberFormat.UInt16BE)
        return pins.i2cReadNumber(EEPROM_I2C_ADDR, NumberFormat.UInt16BE)
    }

    /**
     * init a analog output PWM frequency
     * @param index Motor number 1-4, eg: 2
     */
    function initPwm(index: Motors): void {
        if (index == 1) {
            pins.analogSetPeriod(AnalogPin.P8, 20)	//50KHz
            pins.analogSetPeriod(AnalogPin.P12, 20)	//50KHz
            let pwm1init = true
        }
        if (index == 2) {
            pins.analogSetPeriod(AnalogPin.P13, 20)	//50KHz
            pins.analogSetPeriod(AnalogPin.P14, 20)	//50KHz
            let pwm2init = true
        }
        if (index == 3) {
            pins.analogSetPeriod(AnalogPin.P15, 20)	//50KHz
            pins.analogSetPeriod(AnalogPin.P16, 20)	//50KHz
            let pwm3init = true
        }
        if (index == 4) {
            if (use_controller == false) {
                pins.analogSetPeriod(AnalogPin.P1, 20)	//50KHz
                pins.analogSetPeriod(AnalogPin.P2, 20)	//50KHz
                let pwm4init = true
            } else {
                serial.writeString("Disabled M4\n\r")
            }
        }
    }

    //% weight=79
    //% blockId=motor_SW_detecting block="コントローラ入力あり?"
    export function SW_detecting(): boolean {
        let chg = 0
        if (set_swstatus_without_chattering()) {
            chg = sw_status ^ sw_last_status
            sw_last_status = sw_status
            if (chg) return true
        }
        return false
    }

	/*
	 * 最新のコントロールパッドのスイッチデータを返す
     * 8ビットのビットパターンになっていて、複数ボタンの情報がわかる
     *      A                        
     *   C  +  D →→→　D C B A
     *      B    
     * bit:7 6 5 4 3 2 1 0
     *     | | | | | | | +----左A
     *     | | | | | | +------左B
     *     | | | | | +--------左C
     *     | | | | +----------左D
     *     | | | +------------右A
     *     | | +--------------右B
     *     | +----------------右C
     *     +------------------右D
    */
    //% weight=78
    //% blockId=motor_SW_data block="コントローラデータ"
    export function ControllerButtonData(): number {
        // アナログコントローラのボタンデータを返す
        //  SW_detecting()で検出されたボタンデータのみを返す
        set_swstatus_without_chattering()
        return (sw_status & 0xff)
    }

    //% weight=77
    //% blockId=motor_SW_bit block="コントローラ押されているか？ ボタン|%ControllerSw"
    //% inlineInputMode=inline
    export function isControllerButtonBit(SwBit: ControllerSw): boolean {
        if (sw_status & SwBit) return true
        return false
    }

    //% weight=76
    //% blockId=motor_bit_on_off block="ボタンデータ設定|%val|のボタン|%ControllerSw|を設定|%BitOnOff"
    //% inlineInputMode=inline
    export function ButtonBitOnOff(val: number, SwBit: ControllerSw, OnOff: BitOnOff): number {
        if (OnOff) return val | SwBit
        else return val & ~SwBit
    }

    //% weight=99
    //% blockId=motor_MotorOnOff block="モータON|%index|動作|%Dir"
    export function MotorOnOff(index: Motors, direction: Dir): void {
        if (index == 1) {	//Motor1
            if (direction == 1) {
                pins.digitalWritePin(DigitalPin.P8, 1)
                pins.digitalWritePin(DigitalPin.P12, 0)
            } else if (direction == 2) {
                pins.digitalWritePin(DigitalPin.P8, 0)
                pins.digitalWritePin(DigitalPin.P12, 1)
            } else {
                pins.digitalWritePin(DigitalPin.P8, 0)
                pins.digitalWritePin(DigitalPin.P12, 0)
            }
        }
        if (index == 2) {	//Motor2
            if (direction == 1) {
                pins.digitalWritePin(DigitalPin.P13, 1)
                pins.digitalWritePin(DigitalPin.P14, 0)
            } else if (direction == 2) {
                pins.digitalWritePin(DigitalPin.P13, 0)
                pins.digitalWritePin(DigitalPin.P14, 1)
            } else {
                pins.digitalWritePin(DigitalPin.P13, 0)
                pins.digitalWritePin(DigitalPin.P14, 0)
            }
        }
        if (index == 3) {	//Motor3
            if (direction == 1) {
                pins.digitalWritePin(DigitalPin.P15, 1)
                pins.digitalWritePin(DigitalPin.P16, 0)
            } else if (direction == 2) {
                pins.digitalWritePin(DigitalPin.P15, 0)
                pins.digitalWritePin(DigitalPin.P16, 1)
            } else {
                pins.digitalWritePin(DigitalPin.P15, 0)
                pins.digitalWritePin(DigitalPin.P16, 0)
            }
        }
        if (index == 4) {	//Motor4
            if (use_controller == false) {
                if (direction == 1) {
                    pins.digitalWritePin(DigitalPin.P1, 1)
                    pins.digitalWritePin(DigitalPin.P2, 0)
                } else if (direction == 2) {
                    pins.digitalWritePin(DigitalPin.P1, 0)
                    pins.digitalWritePin(DigitalPin.P2, 1)
                } else {
                    pins.digitalWritePin(DigitalPin.P1, 0)
                    pins.digitalWritePin(DigitalPin.P2, 0)
                }
            } else {
                serial.writeString("Disabled M4\n\r")
            }
        }
    }

    //% weight=95
    //% blockId=motor_MotorSpeed block="モータスピード|%index|動作|%Dir|スピード|%speed"
    //% speed.min=0 speed.max=1023
    export function MotorSpeed(index: Motors, direction: Dir, speed: number): void {
        if (speed >= 1024) {
            speed = 1023
        }
        if (speed < 0) {
            speed = 0
        }
        if (index == 1) {	//Motor1
            if (!pwm1init) {
                initPwm(1)
            }
            if (direction == 1) {
                pins.analogWritePin(AnalogPin.P8, speed)
                pins.digitalWritePin(DigitalPin.P12, 0)
            } else if (direction == 2) {
                pins.digitalWritePin(DigitalPin.P8, 0)
                pins.analogWritePin(AnalogPin.P12, speed)
            } else {
                pins.digitalWritePin(DigitalPin.P8, 0)
                pins.digitalWritePin(DigitalPin.P12, 0)
            }
        }
        if (index == 2) {	//Motor2
            if (!pwm2init) {
                initPwm(2)
            }
            if (direction == 1) {
                pins.analogWritePin(AnalogPin.P13, speed)
                pins.digitalWritePin(DigitalPin.P14, 0)
            } else if (direction == 2) {
                pins.digitalWritePin(DigitalPin.P13, 0)
                pins.analogWritePin(AnalogPin.P14, speed)
            } else {
                pins.digitalWritePin(DigitalPin.P13, 0)
                pins.digitalWritePin(DigitalPin.P14, 0)
            }
        }
        if (index == 3) {	//Motor3
            if (!pwm3init) {
                initPwm(3)
            }
            if (direction == 1) {
                pins.analogWritePin(AnalogPin.P15, speed)
                pins.digitalWritePin(DigitalPin.P16, 0)
            } else if (direction == 2) {
                pins.digitalWritePin(DigitalPin.P15, 0)
                pins.analogWritePin(AnalogPin.P16, speed)
            } else {
                pins.digitalWritePin(DigitalPin.P15, 0)
                pins.digitalWritePin(DigitalPin.P16, 0)
            }
        }
        if (index == 4) {	//Motor4
            if (use_controller == false) {
                if (!pwm4init) {
                    initPwm(4)
                }
                if (direction == 1) {
                    pins.analogWritePin(AnalogPin.P1, speed)
                    pins.digitalWritePin(DigitalPin.P2, 0)
                } else if (direction == 2) {
                    pins.digitalWritePin(DigitalPin.P1, 0)
                    pins.analogWritePin(AnalogPin.P2, speed)
                } else {
                    pins.digitalWritePin(DigitalPin.P1, 0)
                    pins.digitalWritePin(DigitalPin.P2, 0)
                }
            } else {
                serial.writeString("Disabled M4\n\r")
            }
        }
    }

    //% weight=98
    //% blockId=motor_MotorStop block="モータ停止|%index"
    export function MotorStop(index: Motors): void {
        if (index == 1) {	//Motor1
            pins.digitalWritePin(DigitalPin.P8, 0)
            pins.digitalWritePin(DigitalPin.P12, 0)
        }
        if (index == 2) {	//Motor2
            pins.digitalWritePin(DigitalPin.P13, 0)
            pins.digitalWritePin(DigitalPin.P14, 0)
        }
        if (index == 3) {	//Motor3
            pins.digitalWritePin(DigitalPin.P15, 0)
            pins.digitalWritePin(DigitalPin.P16, 0)
        }
        if (index == 4) {	//Motor4
            if (use_controller == false) {
                pins.digitalWritePin(DigitalPin.P1, 0)
                pins.digitalWritePin(DigitalPin.P2, 0)
            } else {
                serial.writeString("Disabled M4\n\r")
            }
        }
    }

    //% weight=97
    //% blockId=motor_MotorWhole block="モータ一括ON|%motorall"
    export function MotorWhole(motorall: number): void {
        serial.writeString("MotorWhole=")
        serial.writeNumber(motorall)
        serial.writeString("\n\r")
        if (motorall < 0 || 255 < motorall) {
            // 無効データやEEPerrのデータは無視される
            return	//Error
        }
        if (motorall & 1) {	//Motor1-1
            pins.digitalWritePin(DigitalPin.P8, 1)
        } else {
            pins.digitalWritePin(DigitalPin.P8, 0)
        }
        if (motorall & 2) {	//Motor1-2
            pins.digitalWritePin(DigitalPin.P12, 1)
        } else {
            pins.digitalWritePin(DigitalPin.P12, 0)
        }
        if (motorall & 4) {	//Motor2-1
            pins.digitalWritePin(DigitalPin.P13, 1)
        } else {
            pins.digitalWritePin(DigitalPin.P13, 0)
        }
        if (motorall & 8) {	//Motor2-2
            pins.digitalWritePin(DigitalPin.P14, 1)
        } else {
            pins.digitalWritePin(DigitalPin.P14, 0)
        }
        if (motorall & 16) {	//Motor3-1
            pins.digitalWritePin(DigitalPin.P15, 1)
        } else {
            pins.digitalWritePin(DigitalPin.P15, 0)
        }
        if (motorall & 32) {	//Motor3-2
            pins.digitalWritePin(DigitalPin.P16, 1)
        } else {
            pins.digitalWritePin(DigitalPin.P16, 0)
        }
        if (motorall & 64) {	//Motor4-1
            pins.digitalWritePin(DigitalPin.P1, 1)
        } else {
            pins.digitalWritePin(DigitalPin.P1, 0)
        }
        if (use_controller == false) {
            if (motorall & 128) {	//Motor4-2
                pins.digitalWritePin(DigitalPin.P2, 1)
            } else {
                pins.digitalWritePin(DigitalPin.P2, 0)
            }
        }
    }

    /**
     * Make motor whole data from each motor controls
     * @param Motor1 motor direction 
     * @param Motor2 motor direction 
     * @param Motor3 motor direction 
     * @param Motor4 motor direction 
     */
    //% weight=96
    //% blockId=motor_MakeMotorData block="モータデータ作成 M1|%Dir|M2|%Dir1|M3|%Dir2|M4|%Dir3"
    //% inlineInputMode=inline
    export function MakeMotorData(Motor1: Dir, Motor2: Dir1, Motor3: Dir2, Motor4: Dir3): number {
        serial.writeString("MakeMotorData=")
        serial.writeNumber(Motor1)
        serial.writeString(",")
        serial.writeNumber(Motor2)
        serial.writeString(",")
        serial.writeNumber(Motor3)
        serial.writeString(",")
        serial.writeNumber(Motor4)
        serial.writeString("\n\r")
        return ((Motor4 << 6) | (Motor3 << 4) | (Motor2 << 2) | Motor1)
    }

    // 記録開始
    //% weight=89
    //% blockId=motor_RecMotorStart block="記録 開始宣言"
    export function RecMotorStart(): void {
        if (eep_mode) {
            serial.writeLine("Using EEP")
            return
        }
        rec_start_tm = input.runningTime()
        eep_write_addr = 0
        last_controls = 0
        EEPerr &= 0xfe          // Reset Eof
        serial.writeLine("Start Recording")
        eep_mode = 2
    }
    // 記録停止
    //% weight=88
    //% blockId=motor_RecMotorStop block="記録 終了宣言"
    export function RecMotorStop(): void {
        if (eep_mode == 2) {
            EEPerr |= 1
            rec_start_tm = 0
            serial.writeLine("Stop Recording")
            eep_write_word(eep_write_addr, 0)
            eep_write_addr += 2
            eep_write_word(eep_write_addr, 0xffff)
            last_controls = 0
            eep_mode = 0
        }
    }

    /*
     * モーターデータを送って変化があったときにEEP記録する
     * 同時に現在経過時間も記録する
     * モーターデータに変化が無いならすぐに戻る
     * EEPが利用できない場合すぐに戻る
     * control：モータデータは8ビット長であり、以下のようになっている
     * bit:7 6 5 4 3 2 1 0
     *     | | | | | | | +----モーター１　FWD
     *     | | | | | | +------モーター１　RWD
     *     | | | | | +--------モーター２　FWD
     *     | | | | +----------モーター２　RWD
     *     | | | +------------モーター３　FWD
     *     | | +--------------モーター３　RWD
     *     | +----------------モーター４　FWD (将来機能）
     *     +------------------モーター４　RWD (将来機能）
     * mode：モータデータは5ビット長であり、以下のようになっている
     * bit:4 3 2 1 0
     *     | | | | +----------モード (将来機能）
     *     | | | +------------モード (将来機能）
     *     | | +--------------モード (将来機能）
     *     | +----------------モード (将来機能）
     *     +------------------モード (将来機能）
     */
    //% weight=88
    //% blockId=motor_RecMotorData block="記録 操作|%control|オプション|%mode"
    //% control.min=0 control.max=255 control.defl=0
    //% mode.min=0 mode.max=31 mode.defl=0
    export function RecMotorData(control: number, mode: number): void {
        if (eep_mode != 2) return   // not write mode
        if (EEPerr) return      // Error
        if (eep_write_addr == 0) { //最初の書き込み
            last_controls = 0
            rec_start_tm = input.runningTime()
            eep_write_dword(0, 0x4b524320)
            //eep_write_word(0, 0x4b52)	//Magic number "KR"
            //eep_write_word(2, 0x4320)	//Magic number "C "
            eep_write_addr = 4
            serial.writeLine("RecMotorData 1st")
            //書き込めたかチェックする
            if (eep_read_word(0) != 0x4b52) EEPerr = 2
            serial.writeNumber(eep_read_word(0))
            serial.writeString(",")
            if (eep_read_word(2) != 0x4320) EEPerr = 2
            serial.writeNumber(eep_read_word(2))
            serial.writeString(">>")
            serial.writeNumber(EEPerr)
            serial.writeString("\n\r")
        }
        elapsed_tm = (input.runningTime() - rec_start_tm) / 10
        if (elapsed_tm >= MAX_EEP_TIME) {		// 最大記録時間超過
            RecMotorStop()
            EEPerr |= 1
            return
        }
        if (control != last_controls) {
            // EEPに記録
            last_controls = control
            eep_write_word(eep_write_addr, elapsed_tm)
            eep_write_addr += 2
            serial.writeNumber(eep_write_addr)
            serial.writeString(" Elapsed:")
            serial.writeNumber(elapsed_tm)
            eep_write_word(eep_write_addr, control + (mode << 8))
            eep_write_addr += 2
            serial.writeString(" Control:")
            serial.writeNumber(control)
            serial.writeString("\n\r")
        }
        if (eep_write_addr >= MAX_EEP_ADDR) {		// 最大記録アドレス超過
            RecMotorStop()
            EEPerr |= 1
        }
    }

    // eep_next_tm,eep_next_contに次のデータをICHIGO-ROMから読む
    // アドレスは自動インクリメント
    function read_next_control() {
        serial.writeString("Adr:")
        serial.writeNumber(eep_read_addr)
        serial.writeString(" [tm:")
        eep_next_tm = eep_read_word(eep_read_addr)
        serial.writeNumber(eep_next_tm)
        serial.writeString(" ct:")
        eep_read_addr += 2
        eep_next_cont = eep_read_word(eep_read_addr)
        serial.writeNumber(eep_next_cont)
        serial.writeString("] ")
        eep_read_addr += 2
    }

    // 再生開始
    //% weight=85
    //% blockId=motor_PlayMotorStart block="再生 開始宣言"
    export function PlayMotorStart(): void {
        if (eep_mode) {
            serial.writeLine("Using EEP")
            return
        }
        serial.writeLine("Start Playing")
        play_start_tm = input.runningTime()
        eep_read_addr = 0
        EEPerr &= 0xfe          // Reset Eof
        eep_mode = 1
    }
    // 再生停止
    //% weight=82
    //% blockId=motor_PlayMotorStop block="再生 終了宣言"
    export function PlayMotorStop(): void {
        if (eep_mode == 1) {
            serial.writeLine("Stop Playing")
            play_start_tm = 0
            eep_read_addr = 0
            EEPerr |= 1
            eep_mode = 0
        }
    }
    // データ継続か（EOFのチェック）
    //% weight=84
    //% blockId=motor_PlayMotorOk block="再生 Ok?"
    export function isPlayMotorOk(): boolean {
        if (eep_mode != 1) return false
        if (EEPerr) {
            return false
        } else {
            return true
        }
    }

    /*
     * EEPに記録されたデータを読み込み、現在経過時間と比較して、記録時間になったらモータ状態を返す
     * 経過時間未満ならすぐに戻る
     * EEPが利用できない場合すぐに戻る
     * 戻るときにデータは16ビット長であり、以下のようになっている
     *     1 1 1 1 1 1 0 0 0 0 0 0 0 0 0 0
     * bit:5 4 3 2 1 0 9 8 7 6 5 4 3 2 1 0
     *     | | | | | | | | | | | | | | | +----モーター１　FWD
     *     | | | | | | | | | | | | | | +------モーター１　RWD
     *     | | | | | | | | | | | | | +--------モーター２　FWD
     *     | | | | | | | | | | | | +----------モーター２　RWD
     *     | | | | | | | | | | | +------------モーター３　FWD
     *     | | | | | | | | | | +--------------モーター３　RWD
     *     | | | | | | | | | +----------------モーター４　FWD (将来機能）
     *     | | | | | | | | +------------------モーター４　RWD (将来機能）
     *     | | | | | | | +--------------------モード (将来機能）
     *     | | | | | | +----------------------モード (将来機能）
     *     | | | | | +------------------------モード (将来機能）
     *     | | | | +--------------------------モード (将来機能）
     *     | | | +----------------------------モード (将来機能）
     *     | | +------------------------------データの有効性 1:無効データ
     *     | +--------------------------------EEPerr  1:Eof  
     *     +----------------------------------EEPerr  1:No data
     */
    //% weight=83
    //% blockId=motor_PlayMotorData block="再生 データ読み込み"
    export function PlayMotorData(): number {
        if (eep_mode != 1) return 0x8000    // EEPerr = 2
        if (eep_read_addr == 0) { //最初の読み込み
            play_start_tm = input.runningTime()
            //Magic numberのチェック
            serial.writeLine("Start Playing 1st")
            eep_markstr = eep_read_word(eep_read_addr)
            if (eep_markstr != 0x4b52) EEPerr = 2         // "KR"
            serial.writeNumber(eep_markstr)
            serial.writeString(",")
            eep_read_addr += 2
            eep_markstr = eep_read_word(eep_read_addr)
            if (eep_markstr != 0x4320) EEPerr = 2       // "C "
            serial.writeNumber(eep_markstr)
            serial.writeString(">>")
            serial.writeNumber(EEPerr)
            serial.writeString("\n\r")
            eep_read_addr += 2
            read_next_control()
        }
        elapsed_tm = (input.runningTime() - play_start_tm) / 10
        if (elapsed_tm >= MAX_EEP_TIME) {		// 最大記録時間超過
            EEPerr |= 1
            serial.writeString("OverMaxTime ")
            serial.writeNumber(EEPerr)
            serial.writeString("\n\r")
        }
        let retdata = 0x2000	// デフォルトは無効データ
        if (EEPerr == 0) {		// ready eeprom
            if (elapsed_tm >= eep_next_tm) {
                serial.writeNumber(eep_read_addr)
                serial.writeString(" Elapsed:")
                serial.writeNumber(Math.trunc(elapsed_tm))
                serial.writeString(" (")
                serial.writeNumber(eep_next_tm)
                serial.writeString(") Control:")
                serial.writeNumber(eep_next_cont)
                serial.writeString("\n\r")
                retdata = eep_next_cont & 0x1fff	//有効データをセット
                read_next_control()
                if (eep_next_tm == 0) {
                    EEPerr |= 1
                    serial.writeLine("Finished")
                }
            }
        }
        if (eep_read_addr >= MAX_EEP_ADDR) {		// 最大記録アドレス超過
            EEPerr |= 1
        }
        retdata |= (EEPerr << 14)
        //serial.writeNumber(retdata) // only debug
        //serial.writeString(",")     // only debug
        return retdata
    }

    /**
     * write a byte to function area address
     * @param addr function number 0-3, 0-3 eg: 1
     * @param dat is the data will be write, eg: 5
     */
    //% blockId="WriteFunc" block="ファンクション番号 %addr|保存データ %dat"
    //% weight=69 
    export function eep_write_func(addr: number, dat: number): void {
        if (addr >= 0 && addr <= 3) {
            eep_write_byte(FUNC_EEP_ADDR + addr, dat)
        }
    }

    /**
     * read a byte from special address
     * @param addr function number 0-3, eg: 1
     */
    //% blockId="ReadFunc" block="ファンクション番号 %addr"
    //% weight=68 
    export function eep_read_func(addr: number): number {
        if (addr >= 0 && addr <= 3) {
            return eep_read_byte(FUNC_EEP_ADDR + addr)
        } else {
            return 0
        }
    }
}
